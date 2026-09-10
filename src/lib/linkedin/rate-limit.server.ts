/**
 * Small in-memory sliding-window limiter. Per worker instance, so it is a
 * safety valve against runaway clients rather than a distributed quota.
 */
type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((at) => now - at < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 5000) buckets.clear();
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

export const SEARCH_RATE_LIMIT = { limit: 10, windowMs: 60_000 };
export const HEALTH_RATE_LIMIT = { limit: 30, windowMs: 60_000 };
