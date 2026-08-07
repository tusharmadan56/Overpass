import Redis from 'ioredis';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokenBucketScript = readFileSync(join(__dirname, 'tokenBucket.lua'), 'utf8');

export async function createRedisRateLimiter({ redisUrl, capacity, refillRatePerSec }) {
  const redis = new Redis(redisUrl);

  await redis.ping();

  const scriptSha = await redis.script('load', tokenBucketScript);

  return {
    async allow(key) {
      const nowMs = Date.now();

      try {
        const result = await redis.evalsha(scriptSha, 1, key, capacity, refillRatePerSec, nowMs);

        const [allowedInt, limit, remaining, resetAtMs] = result;
        const allowed = allowedInt === 1;

        return {
          allowed,
          limit,
          remaining,
          resetAt: resetAtMs,
        };
      } catch (err) {
        if (err.message.includes('NOSCRIPT')) {
          const result = await redis.eval(tokenBucketScript, 1, key, capacity, refillRatePerSec, nowMs);
          const [allowedInt, limit, remaining, resetAtMs] = result;
          const allowed = allowedInt === 1;

          return { allowed, limit, remaining, resetAt: resetAtMs };
        }
        throw err;
      }
    },
  };
}
