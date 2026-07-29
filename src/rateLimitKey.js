export function getClientKey(req) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    return apiKey;
  }
  return req.socket.remoteAddress;
}
