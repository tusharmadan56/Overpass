import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

export function loadConfig(path = 'config.yaml') {
  const raw = load(readFileSync(path, 'utf8'));

  if (!raw.backends || raw.backends.length === 0) {
    throw new Error('config: at least one backend is required');
  }

  const backends = [];
  const seenIds = new Set();

  for (let i = 0; i < raw.backends.length; i++) {
    const entry = raw.backends[i];

    if (!entry.id) {
      throw new Error(`config: backends[${i}] is missing an id`);
    }
    if (seenIds.has(entry.id)) {
      throw new Error(`config: duplicate backend id "${entry.id}"`);
    }
    seenIds.add(entry.id);

    // 
    // a typo in the config fails at startup instead of on the first request.
    backends.push({ id: entry.id, url: new URL(entry.url) });
  }

  return {
    port: raw.gateway?.port ?? 8080,
    upstreamTimeoutMs: raw.gateway?.upstreamTimeoutMs ?? 10000,
    strategy: raw.gateway?.strategy ?? 'round-robin',
    healthCheck: {
      intervalMs: raw.healthCheck?.intervalMs ?? 5000,
      timeoutMs: raw.healthCheck?.timeoutMs ?? 2000,
      unhealthyThreshold: raw.healthCheck?.unhealthyThreshold ?? 3,
      healthyThreshold: raw.healthCheck?.healthyThreshold ?? 2,
    },
    rateLimit: {
      algorithm: raw.rateLimit?.algorithm ?? 'token-bucket',
      capacity: raw.rateLimit?.capacity ?? 20,
      refillRatePerSec: raw.rateLimit?.refillRatePerSec ?? 5,
      limit: raw.rateLimit?.limit ?? 20,
      windowMs: raw.rateLimit?.windowMs ?? 10000,
      redisUrl: raw.rateLimit?.redisUrl ?? null,
    },
    backends,
  };
}
