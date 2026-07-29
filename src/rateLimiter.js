
export function createFixedWindowLimiter({ limit, windowMs, now = Date.now }) {
  const windows = new Map();

  return {
    async allow(key) {
      const currentTime = now();
      const windowStart = Math.floor(currentTime / windowMs) * windowMs;

      let entry = windows.get(key);
      if (!entry || entry.windowStart !== windowStart) {
        entry = { windowStart, count: 0 };
        windows.set(key, entry);
      }

      entry.count += 1;

      return {
        allowed: entry.count <= limit,
        limit,
        remaining: Math.max(0, limit - entry.count),
        resetAt: windowStart + windowMs,
      };
    },
  };
}
