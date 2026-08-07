import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createRoundRobin, createLeastConnections } from './balancer.js';
import { createHealthChecker } from './health.js';
import { createRequestHandler } from './proxy.js';
import { createRateLimiter } from './rateLimiter.js';
import { createRedisRateLimiter } from './redisRateLimiter.js';
import { createMetricsCollector } from './metrics.js';

async function main() {
  const config = loadConfig();

  const healthChecker = createHealthChecker(config.backends, config.healthCheck);
  healthChecker.start();

  const balancer =
    config.strategy === 'least-connections'
      ? createLeastConnections(config.backends, healthChecker.isHealthy)
      : createRoundRobin(config.backends, healthChecker.isHealthy);

  let rateLimiter;
  if (config.rateLimit.redisUrl) {
    rateLimiter = await createRedisRateLimiter({
      redisUrl: config.rateLimit.redisUrl,
      capacity: config.rateLimit.capacity,
      refillRatePerSec: config.rateLimit.refillRatePerSec,
    });
    console.log('[overpass] using Redis-backed distributed rate limiter');
  } else {
    rateLimiter = createRateLimiter(config.rateLimit);
    console.log('[overpass] using in-memory rate limiter');
  }

  const metrics = createMetricsCollector();

  const server = createServer(createRequestHandler(config, balancer, rateLimiter, metrics));

  server.listen(config.port, () => {
    console.log(`[overpass] gateway listening on http://localhost:${config.port}`);
    console.log(`[overpass] metrics available at http://localhost:${config.port}/metrics`);
  });
}

main().catch((err) => {
  console.error('[overpass] startup failed:', err.message);
  process.exit(1);
});
