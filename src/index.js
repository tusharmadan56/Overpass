import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = 8080;
const BACKEND = new URL('http://localhost:9001');

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

function buildForwardHeaders(req, requestId) {
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
  headers.host = BACKEND.host;

  return headers;
}

const server = createServer((req, res) => {
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  res.setHeader('x-request-id', requestId);

  const upstream = request(
    {
      hostname: BACKEND.hostname,
      port: BACKEND.port,
      path: req.url,
      method: req.method,
      headers: buildForwardHeaders(req, requestId),
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  // Upstream unreachable or connection reset.
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad gateway' }));
    }
  });

  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`[overpass] gateway listening on http://localhost:${PORT}`);
});
