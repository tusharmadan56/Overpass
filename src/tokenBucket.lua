-- Atomic token bucket on Redis. Called as EVALSHA script_hash 1 key [capacity] [refillRatePerSec] [currentTimeMs]
-- Returns: {allowed, limit, remaining, resetAtMs}
--
-- Redis key structure: key = "key:tb" stores JSON {tokens, lastRefillMs}

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

local stored = redis.call('GET', key)
local bucket

if stored == false then
  bucket = { tokens = capacity, lastRefillMs = nowMs }
else
  bucket = cjson.decode(stored)
end

local elapsedSec = (nowMs - bucket.lastRefillMs) / 1000
local tokensAdded = elapsedSec * refillRate
bucket.tokens = math.min(capacity, bucket.tokens + tokensAdded)
bucket.lastRefillMs = nowMs

local allowed = bucket.tokens >= 1
if allowed then
  bucket.tokens = bucket.tokens - 1
end

redis.call('SET', key, cjson.encode(bucket))

local deficit = math.max(0, 1 - bucket.tokens)
local resetAtMs = nowMs + (deficit / refillRate) * 1000

return { allowed and 1 or 0, capacity, math.floor(bucket.tokens), math.ceil(resetAtMs) }
