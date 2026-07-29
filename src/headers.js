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

export function buildForwardHeaders(req, backend, requestId) {
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
