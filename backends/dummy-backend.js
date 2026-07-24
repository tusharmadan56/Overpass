import { createServer } from 'node:http';

// Stand-in backend for local testing. Responds with its own id so we can see
// which instance the balancer picked. Usage: dummy-backend.js <id> <port>
const id = process.argv[2] ?? 'backend-unknown';
const port = Number(process.argv[3] ?? 9001);
// Optional artificial response delay (ms) for exercising slow-upstream paths.
const latencyMs = Number(process.argv[4] ?? 0);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', id }));
    return;
  }

  const respond = () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        servedBy: id,
        port,
        method: req.method,
        path: req.url,
        forwardedFor: req.headers['x-forwarded-for'],
        requestId: req.headers['x-request-id'],
        host: req.headers.host,
      }),
    );
  };

  if (latencyMs > 0) setTimeout(respond, latencyMs);
  else respond();
});

server.listen(port, () => {
  console.log(`[${id}] listening on http://localhost:${port}`)
});
