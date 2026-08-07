import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFixedWindowLimiter,
  createSlidingLogLimiter,
  createSlidingWindowCounterLimiter,
  createTokenBucketLimiter,
} from '../src/rateLimiter.js';

describe('fixed window limiter', () => {
  test('allows requests up to the limit, then rejects', async () => {
    const limiter = createFixedWindowLimiter({ limit: 3, windowMs: 1000, now: () => 0 });

    const first = await limiter.allow('a');
    const second = await limiter.allow('a');
    const third = await limiter.allow('a');
    const fourth = await limiter.allow('a');

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, true);
    assert.equal(fourth.allowed, false);
  });

  test('resets the count once the clock enters a new window', async () => {
    let currentTime = 0;
    const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1000, now: () => currentTime });

    await limiter.allow('a');
    await limiter.allow('a');
    const blocked = await limiter.allow('a');
    assert.equal(blocked.allowed, false);

    currentTime = 1000;
    const afterReset = await limiter.allow('a');
    assert.equal(afterReset.allowed, true);
  });

  test('tracks different keys independently', async () => {
    const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1000, now: () => 0 });

    const a = await limiter.allow('a');
    const b = await limiter.allow('b');

    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
  });

  test('lets close to double the limit through around a window boundary', async () => {
    let currentTime = 900;
    const limiter = createFixedWindowLimiter({ limit: 5, windowMs: 1000, now: () => currentTime });

    let allowedCount = 0;
    for (let i = 0; i < 5; i++) {
      const result = await limiter.allow('a');
      if (result.allowed) allowedCount++;
    }

    currentTime = 1001; // just over the edge into the next window
    for (let i = 0; i < 5; i++) {
      const result = await limiter.allow('a');
      if (result.allowed) allowedCount++;
    }

    // 10 requests got through in about 100ms, even though the limit is "5 per second"
    assert.equal(allowedCount, 10);
  });
});

describe('sliding window log limiter', () => {
  test('allows requests up to the limit, then rejects', async () => {
    const limiter = createSlidingLogLimiter({ limit: 3, windowMs: 1000, now: () => 0 });

    await limiter.allow('a');
    await limiter.allow('a');
    await limiter.allow('a');
    const fourth = await limiter.allow('a');

    assert.equal(fourth.allowed, false);
  });

  test('expires old entries one at a time as the window slides forward', async () => {
    let currentTime = 0;
    const limiter = createSlidingLogLimiter({ limit: 3, windowMs: 1000, now: () => currentTime });

    await limiter.allow('a'); // t=0
    currentTime = 500;
    await limiter.allow('a'); // t=500
    await limiter.allow('a'); // t=500
    const full = await limiter.allow('a');
    assert.equal(full.allowed, false);

    currentTime = 1001; // the t=0 entry has aged out, the two t=500 entries haven't
    const result = await limiter.allow('a');
    assert.equal(result.allowed, true);
  });

  test('rejects the same boundary burst that fixed window let through', async () => {
    let currentTime = 900;
    const limiter = createSlidingLogLimiter({ limit: 5, windowMs: 1000, now: () => currentTime });

    let allowedCount = 0;
    for (let i = 0; i < 5; i++) {
      const result = await limiter.allow('a');
      if (result.allowed) allowedCount++;
    }

    currentTime = 1001;
    for (let i = 0; i < 5; i++) {
      const result = await limiter.allow('a');
      if (result.allowed) allowedCount++;
    }

    // the first 5 are still inside the trailing 1000ms window, so the second
    // batch gets rejected entirely
    assert.equal(allowedCount, 5);
  });
});

describe('sliding window counter limiter', () => {
  test('a new window still carries weighted load from the previous one', async () => {
    let currentTime = 0;
    const limiter = createSlidingWindowCounterLimiter({ limit: 10, windowMs: 1000, now: () => currentTime });

    for (let i = 0; i < 10; i++) {
      await limiter.allow('a');
    }
    const exhausted = await limiter.allow('a');
    assert.equal(exhausted.allowed, false);

    currentTime = 1000; // right at the boundary - fixed window would already be back to 0 here
    const atBoundary = await limiter.allow('a');
    assert.equal(atBoundary.allowed, false);

    currentTime = 1500; // halfway into the new window, the previous window's weight has halved
    const halfwayIn = await limiter.allow('a');
    assert.equal(halfwayIn.allowed, true);
  });
});

describe('token bucket limiter', () => {
  test('allows a burst up to capacity, then rejects', async () => {
    const limiter = createTokenBucketLimiter({ capacity: 5, refillRatePerSec: 5, now: () => 0 });

    for (let i = 0; i < 5; i++) {
      const result = await limiter.allow('a');
      assert.equal(result.allowed, true);
    }

    const sixth = await limiter.allow('a');
    assert.equal(sixth.allowed, false);
  });

  test('refills over time at the configured rate, capped at capacity', async () => {
    let currentTime = 0;
    const limiter = createTokenBucketLimiter({ capacity: 5, refillRatePerSec: 5, now: () => currentTime });

    for (let i = 0; i < 5; i++) {
      await limiter.allow('a');
    }
    const empty = await limiter.allow('a');
    assert.equal(empty.allowed, false);

    currentTime = 400; // 5 tokens/sec * 0.4s = 2 tokens back
    const first = await limiter.allow('a');
    const second = await limiter.allow('a');
    const third = await limiter.allow('a');
    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false); // only 2 tokens were available

    currentTime = 5000; // long idle gap - refill shouldn't overflow past capacity
    const afterLongWait = await limiter.allow('a');
    assert.equal(afterLongWait.allowed, true);
    assert.equal(afterLongWait.remaining, 4);
  });

  test('never throttles requests spaced exactly at the refill rate', async () => {
    let currentTime = 0;
    const limiter = createTokenBucketLimiter({ capacity: 1, refillRatePerSec: 2, now: () => currentTime });

    const first = await limiter.allow('a'); // starts full
    assert.equal(first.allowed, true);

    currentTime = 500; // one refill interval later - 2 tokens/sec means 1 every 500ms
    const second = await limiter.allow('a');
    assert.equal(second.allowed, true);

    currentTime = 1000;
    const third = await limiter.allow('a');
    assert.equal(third.allowed, true);

    currentTime = 1250; // only 250ms later - not a full token yet
    const fourth = await limiter.allow('a');
    assert.equal(fourth.allowed, false);
  });
});
