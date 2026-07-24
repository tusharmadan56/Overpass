import { createServer, request } from 'node:http';

const PORT = 8080;
const BACKEND = new URL('http://localhost:9001');

const server = createServer((req, res) => {
  const upstream = request(
    {
      hostname: BACKEND.hostname,
      port: BACKEND.port,
      path: req.url,
      method: req.method,
      headers: req.headers,
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
