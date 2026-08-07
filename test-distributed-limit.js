import http from 'node:http';

const GATEWAYS = ['http://localhost:8080', 'http://localhost:8081', 'http://localhost:8082'];

async function makeRequest(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode });
      });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.setTimeout(2000);
  });
}

async function test() {
  console.log('=== Distributed rate limit test ===');
  console.log('3 gateways sharing one Redis-backed limit (capacity: 5, refillRate: 1/sec)');
  console.log('Firing 15 requests concurrently (5 to each gateway)...\n');

  const promises = [];
  const results = { 200: 0, 429: 0, other: 0 };

  for (const gateway of GATEWAYS) {
    for (let i = 0; i < 5; i++) {
      promises.push(
        makeRequest(`${gateway}/api/test`).then((res) => {
          const key = res.status === 200 ? '200' : res.status === 429 ? '429' : 'other';
          results[key]++;
          console.log(`[${gateway}] response: ${res.status}`);
        }),
      );
    }
  }

  await Promise.all(promises);

  console.log(`\n=== Results ===`);
  console.log(`200 OK:           ${results[200]}`);
  console.log(`429 Too Many:     ${results[429]}`);
  console.log(`Other/Error:      ${results.other}`);
  console.log(`\nTotal allowed: ${results[200]}`);

  const success = results[200] === 5 && results[429] === 10;
  console.log(`\n${success ? '✔ PASS' : '✗ FAIL'}: Expected 5 allowed, 10 rejected across all 3 gateways`);
  console.log('(If distributed limiting is working, the global limit of 5 prevents more than 5 requests)');

  process.exit(success ? 0 : 1);
}

test().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
