/**
 * In-memory token bucket rate limiter.
 * Fine for a single-instance MVP. Replace with Redis if you scale horizontally.
 *
 * Default: 60 tokens per key, refill 1 token/sec.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const CAPACITY = 60;
const REFILL_PER_SEC = 1;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  if (now - lastSweep > SWEEP_INTERVAL_MS) {
    for (const [k, b] of buckets) {
      if (now - b.lastRefill > SWEEP_INTERVAL_MS) buckets.delete(k);
    }
    lastSweep = now;
  }
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: CAPACITY, lastRefill: now };
    buckets.set(key, bucket);
  }
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_SEC);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
