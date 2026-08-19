// Pure request-guard primitives: token-bucket rate limiting and origin
// checks. No env access, no I/O, unit-testable.

export interface RateLimiterOptions {
  /** Burst size: how many requests a fresh client may make at once. */
  capacity: number;
  refillPerSecond: number;
  /** Bucket table cap; oldest-seen keys are evicted past it. */
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimiter {
  /** Consume one token for this key; false = over the limit right now. */
  take(key: string): boolean;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSecond, maxKeys = 1000, now = () => Date.now() } =
    options;
  const buckets = new Map<string, { tokens: number; at: number }>();

  const evictOldest = () => {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, bucket] of buckets) {
      if (bucket.at < oldestAt) {
        oldestAt = bucket.at;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) buckets.delete(oldestKey);
  };

  return {
    take(key) {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) evictOldest();
        bucket = { tokens: capacity, at: t };
        buckets.set(key, bucket);
      } else {
        bucket.tokens = Math.min(
          capacity,
          bucket.tokens + ((t - bucket.at) / 1000) * refillPerSecond,
        );
        bucket.at = t;
      }
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}

/**
 * Browser-origin check: requests carrying an Origin or Referer from another
 * host are refused. Requests without either (same-origin GETs, curl) pass —
 * this layer stops foreign web pages, not scripts; the rate limiter and the
 * history guard carry the real weight.
 */
export function originAllowed(request: Request): boolean {
  const host = new URL(request.url).host;
  const matches = (value: string | null) => {
    if (!value) return true;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  return (
    matches(request.headers.get("origin")) &&
    matches(request.headers.get("referer"))
  );
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}
