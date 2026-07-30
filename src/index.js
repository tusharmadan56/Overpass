import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createRoundRobin, createLeastConnections } from './balancer.js';
import { createHealthChecker } from './health.js';
import { createRequestHandler } from './proxy.js';
import { createRateLimiter } from './rateLimiter.js';

const config = loadConfig();

const healthChecker = createHealthChecker(config.backends, config.healthCheck);
healthChecker.start();

const balancer =
  config.strategy === 'least-connections'
    ? createLeastConnections(config.backends, healthChecker.isHealthy)
    : createRoundRobin(config.backends, healthChecker.isHealthy);

const rateLimiter = createRateLimiter(config.rateLimit);

const server = createServer(createRequestHandler(config, balancer, rateLimiter));

server.listen(config.port, () => {
  console.log(`[overpass] gateway listening on http://localhost:${config.port}`);
});
