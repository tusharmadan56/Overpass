import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { log } from './logger.js';
import { buildForwardHeaders, applyRateLimitHeaders } from './headers.js';
import { getClientKey } from './rateLimitKey.js';

export function createRequestHandler(config, balancer, rateLimiter) {
  return async function handleRequest(req, res) {
    const startedAt = performance.now();
    const requestId = req.headers['x-request-id'] ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    const decision = await rateLimiter.allow(getClientKey(req));
    applyRateLimitHeaders(res, decision);

    if (!decision.allowed) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'too many requests', requestId }));
      log({
        requestId,
        method: req.method,
        path: req.url,
        status: 429,
        backend: null,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      return;
    }

    const backend = balancer.next(req);

    if (!backend) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no healthy backends available', requestId }));
      log({
        requestId,
        method: req.method,
        path: req.url,
        status: 503,
        backend: null,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      return;
    }

    // 'close' fires once the response is done
    let released = false;
    res.on('close', () => {
      if (released) return;
      released = true;
      balancer.release(backend);
    });

    res.on('finish', () => {
      log({
        requestId,
        method: req.method,
        path: req.url,
        status: res.statusCode,
        backend: backend.id,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    });

    // Guard against emitting more than one response
    let settled = false;
    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      if (!res.headersSent) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: message, requestId }));
      } else {
        res.destroy();
      }
    };

    const upstream = request(
      {
        hostname: backend.url.hostname,
        port: backend.url.port,
        path: req.url,
        method: req.method,
        headers: buildForwardHeaders(req, backend, requestId),
        timeout: config.upstreamTimeoutMs,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    // Backend accepted the connection but stalled: abort and report a timeout
    upstream.on('timeout', () => {
      upstream.destroy();
      fail(504, 'gateway timeout');
    });

    // Backend unreachable or connection reset.
    upstream.on('error', () => fail(502, 'bad gateway'));

    req.pipe(upstream);
  };
}
