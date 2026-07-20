import type { Redis } from "ioredis";

/** Max burst of bids per user per auction before refill. */
export const BID_BUCKET_CAPACITY = 3;
/** One token restored every N milliseconds. */
export const BID_REFILL_MS = 2_000;

const KEY_PREFIX = "bid-rl:";

export type BidRateLimitResult = {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
};

function bucketKey(userId: string, auctionId: string): string {
  return `${KEY_PREFIX}${userId}:${auctionId}`;
}

/**
 * Atomic token bucket: capacity 3, refill 1 token / 2s per (userId, auctionId).
 * Returns whether the request may proceed and Retry-After seconds when denied.
 */
const CONSUME_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
local refill = math.floor(elapsed / refill_ms)
if refill > 0 then
  tokens = math.min(capacity, tokens + refill)
  ts = ts + refill * refill_ms
end

if tokens < cost then
  local deficit = cost - tokens
  local retry_after_ms = deficit * refill_ms - (now - ts)
  if retry_after_ms < refill_ms then retry_after_ms = refill_ms end
  redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
  redis.call('PEXPIRE', key, capacity * refill_ms * 2)
  return {0, math.ceil(retry_after_ms / 1000), tokens}
end

tokens = tokens - cost
redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
redis.call('PEXPIRE', key, capacity * refill_ms * 2)
return {1, 0, tokens}
`;

export async function consumeBidToken(
  redis: Redis,
  userId: string,
  auctionId: string,
  nowMs: number = Date.now(),
): Promise<BidRateLimitResult> {
  const raw = (await redis.eval(
    CONSUME_LUA,
    1,
    bucketKey(userId, auctionId),
    String(BID_BUCKET_CAPACITY),
    String(BID_REFILL_MS),
    String(nowMs),
    "1",
  )) as [number, number, number];

  const allowed = raw[0] === 1;
  const retryAfterSec = Number(raw[1] ?? 0);
  const remaining = Number(raw[2] ?? 0);

  return {
    allowed,
    retryAfterSec: allowed ? 0 : Math.max(1, retryAfterSec),
    remaining,
  };
}

/** Test helper — wipe bucket state for a user/auction pair. */
export async function resetBidRateLimit(
  redis: Redis,
  userId: string,
  auctionId: string,
): Promise<void> {
  await redis.del(bucketKey(userId, auctionId));
}
