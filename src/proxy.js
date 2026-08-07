import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { log } from './logger.js';
import { buildForwardHeaders, applyRateLimitHeaders } from './headers.js';
import { getClientKey } from './rateLimitKey.js';

export function createRequestHandler(config, balancer, rateLimiter, metrics) {
  return async function handleRequest(req, res) {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(metrics.formatMetrics());
      return;
    }
    const startedAt = performance.now();
    const requestId = req.headers['x-request-id'] ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    const decision = await rateLimiter.allow(getClientKey(req));
    applyRateLimitHeaders(res, decision);

    if (!decision.allowed) {
      const latencyMs = Math.round(performance.now() - startedAt);
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'too many requests', requestId }));
      metrics.recordRequest(req.method, 429, latencyMs, null);
      log({
        requestId,
        method: req.method,
        path: req.url,
        status: 429,
        backend: null,
        latencyMs,
      });
      return;
    }

    const backend = balancer.next(req);

    if (!backend) {
      const latencyMs = Math.round(performance.now() - startedAt);
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no healthy backends available', requestId }));
      metrics.recordRequest(req.method, 503, latencyMs, null);
      log({
        requestId,
        method: req.method,
        path: req.url,
        status: 503,
        backend: null,
        latencyMs,
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
      const latencyMs = Math.round(performance.now() - startedAt);
      metrics.recordRequest(req.method, res.statusCode, latencyMs, backend.id);
      log({
        requestId,
        method: req.method,
        path: req.url,
        status: res.statusCode,
        backend: backend.id,
        latencyMs,
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
