
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

// Sliding window log
export function createSlidingLogLimiter({ limit, windowMs, now = Date.now }) {
  const logs = new Map();

  return {
    async allow(key) {
      const currentTime = now();
      const windowStart = currentTime - windowMs;

      let log = logs.get(key);
      if (!log) {
        log = [];
        logs.set(key, log);
      }

      while (log.length > 0 && log[0] <= windowStart) {
        log.shift();
      }

      const allowed = log.length < limit;
      if (allowed) {
        log.push(currentTime);
      }

      return {
        allowed,
        limit,
        remaining: Math.max(0, limit - log.length),
        resetAt: log.length > 0 ? log[0] + windowMs : currentTime + windowMs,
      };
    },
  };
}

// Sliding window counter

export function createSlidingWindowCounterLimiter({ limit, windowMs, now = Date.now }) {
  const state = new Map();

  return {
    async allow(key) {
      const currentTime = now();
      const currentWindowStart = Math.floor(currentTime / windowMs) * windowMs;
      const previousWindowStart = currentWindowStart - windowMs;

      let entry = state.get(key);

      if (!entry || entry.windowStart < previousWindowStart) {
        entry = { windowStart: currentWindowStart, currentCount: 0, previousCount: 0 };
      } else if (entry.windowStart === previousWindowStart) {
        entry = { windowStart: currentWindowStart, currentCount: 0, previousCount: entry.currentCount };
      }
      // else entry.windowStart === currentWindowStart: same window as last call

      state.set(key, entry);

      const elapsedInCurrent = currentTime - currentWindowStart;
      const previousWeight = (windowMs - elapsedInCurrent) / windowMs;
      const estimated = entry.previousCount * previousWeight + entry.currentCount;

      const allowed = estimated < limit;
      if (allowed) {
        entry.currentCount += 1;
      }

      return {
        allowed,
        limit,
        remaining: Math.max(0, Math.floor(limit - estimated)),
        resetAt: currentWindowStart + windowMs,
      };
    },
  };
}
