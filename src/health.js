import { log } from './logger.js';

// Polls each backend's /health endpoint on an interval and tracks a simple
// healthy/unhealthy state per backend. Requires a run of consecutive
// failures/successes before flipping state, so one missed check (network
// blip) doesn't take a backend out of rotation.
export function createHealthChecker(backends, options = {}) {
  const intervalMs = options.intervalMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 2000;
  const unhealthyThreshold = options.unhealthyThreshold ?? 3;
  const healthyThreshold = options.healthyThreshold ?? 2;

  const state = new Map();
  for (const backend of backends) {
    state.set(backend.id, {
      healthy: true,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    });
  }

  async function checkBackend(backend) {
    const entry = state.get(backend.id);
    const healthUrl = new URL('/health', backend.url);

    let ok = false;
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
      ok = res.ok;
    } catch {
      ok = false;
    }

    if (ok) {
      entry.consecutiveFailures = 0;
      entry.consecutiveSuccesses += 1;
      if (!entry.healthy && entry.consecutiveSuccesses >= healthyThreshold) {
        entry.healthy = true;
        log({ event: 'health-check', backend: backend.id, status: 'healthy' });
      }
    } else {
      entry.consecutiveSuccesses = 0;
      entry.consecutiveFailures += 1;
      if (entry.healthy && entry.consecutiveFailures >= unhealthyThreshold) {
        entry.healthy = false;
        log({ event: 'health-check', backend: backend.id, status: 'unhealthy' });
      }
    }
  }

  function runAllChecks() {
    for (const backend of backends) {
      checkBackend(backend);
    }
  }

  function isHealthy(backendId) {
    return state.get(backendId).healthy;
  }

  function start() {
    runAllChecks();
    const timer = setInterval(runAllChecks, intervalMs);
    timer.unref();
    return timer;
  }

  return { start, isHealthy };
}
