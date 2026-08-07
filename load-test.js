import http from 'node:http';

const GATEWAYS = [
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:8082',
];

async function makeRequest(url) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          latencyMs: Date.now() - startTime,
        });
      });
    });
    req.on('error', () => resolve({ status: 0, latencyMs: 0 }));
    req.setTimeout(5000);
  });
}

async function fetchMetrics() {
  return new Promise((resolve) => {
    http.get('http://localhost:8080/metrics', (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve(body);
      });
    });
  });
}

async function runLoadTest() {
  console.log('=== Overpass Load Test ===\n');
  console.log('Testing 3 gateways with distributed rate limiting (Redis backend)');
  console.log('Firing 300 requests concurrently (100 to each gateway)\n');

  const startTime = Date.now();
  const promises = [];
  const results = { 200: 0, 429: 0, 503: 0, other: 0 };
  const latencies = [];

  for (const gateway of GATEWAYS) {
    for (let i = 0; i < 100; i++) {
      promises.push(
        makeRequest(`${gateway}/api/load-test`).then((res) => {
          const key = res.status === 200 ? '200' : res.status === 429 ? '429' : res.status === 503 ? '503' : 'other';
          results[key]++;
          if (res.latencyMs > 0) latencies.push(res.latencyMs);
        }),
      );
    }
  }

  await Promise.all(promises);
  const totalTimeMs = Date.now() - startTime;

  console.log(`=== Load Test Results (${totalTimeMs}ms total) ===\n`);
  console.log(`Responses:`);
  console.log(`  200 OK:           ${results[200]}`);
  console.log(`  429 Too Many:     ${results[429]}`);
  console.log(`  503 Unavailable:  ${results[503]}`);
  console.log(`  Other/Error:      ${results.other}`);

  if (latencies.length > 0) {
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    console.log(`\nLatencies (ms):`);
    console.log(`  Min:              ${minLatency}`);
    console.log(`  Avg:              ${Math.round(avgLatency)}`);
    console.log(`  P50:              ${p50}`);
    console.log(`  P99:              ${p99}`);
    console.log(`  Max:              ${maxLatency}`);
  }

  console.log('\n=== Gateway Metrics ===\n');
  try {
    const metrics = await fetchMetrics();
    console.log(metrics);
  } catch (err) {
    console.log('Could not fetch metrics:', err.message);
  }

  console.log('\n=== Analysis ===\n');
  const allowed = results[200];
  const rejected = results[429];
  const total = allowed + rejected;

  console.log(`Total requests: ${total}`);
  console.log(`Allowed: ${allowed} (${Math.round((allowed / total) * 100)}%)`);
  console.log(`Rejected: ${rejected} (${Math.round((rejected / total) * 100)}%)`);

  console.log(
    `\nWith 3 gateways and a distributed token bucket (capacity: 5, refill: 1/sec),`,
  );
  console.log(`we expect ~5 requests allowed and ~295 rejected (rate limit enforced globally).`);

  process.exit(0);
}

runLoadTest().catch((err) => {
  console.error('Load test failed:', err.message);
  process.exit(1);
});
