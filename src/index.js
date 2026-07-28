import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { log } from './logger.js';
import { loadConfig } from './config.js';
import { createRoundRobin, createLeastConnections } from './balancer.js';

const config = loadConfig();
const balancer =
  config.strategy === 'least-connections'
    ? createLeastConnections(config.backends)
    : createRoundRobin(config.backends);

// Hop-by-hop headers apply to a single transport connection, not the end-to-end
// message, and must not be forwarded by a proxy (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function buildForwardHeaders(req, backend, requestId) {
  const headers = { ...req.headers };
  for (const name of Object.keys(headers)) {
    if (HOP_BY_HOP.has(name)) delete headers[name];
  }

  const clientIp = req.socket.remoteAddress ?? '';
  // X-Forwarded-For is an ordered chain; append the client, never overwrite,
  // so an origin behind multiple proxies stays visible.
  headers['x-forwarded-for'] = headers['x-forwarded-for']
    ? `${headers['x-forwarded-for']}, ${clientIp}`
    : clientIp;
  headers['x-forwarded-host'] = req.headers.host ?? '';
  headers['x-forwarded-proto'] = 'http';
  headers['x-request-id'] = requestId;
  headers.host = backend.url.host;

  return headers;
}

const server = createServer((req, res) => {
  const startedAt = performance.now();
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  res.setHeader('x-request-id', requestId);

  const backend = balancer.next(req);

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
});

server.listen(config.port, () => {
  console.log(`[overpass] gateway listening on http://localhost:${config.port}`);
});
