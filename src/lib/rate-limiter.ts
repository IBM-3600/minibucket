interface Bucket { tokens: number; ts: number; }

/** Simple per-key token-bucket limiter (tokens refill per minute). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private defaultRpm: number) {
    const sweep = setInterval(() => {
      const cutoff = Date.now() - 5 * 60_000;
      for (const [k, b] of this.buckets) if (b.ts < cutoff) this.buckets.delete(k);
    }, 60_000);
    sweep.unref();
  }
  allow(key: string, rpm?: number): boolean {
    const capacity = rpm ?? this.defaultRpm;
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: capacity, ts: now }; this.buckets.set(key, b); }
    const refill = ((now - b.ts) / 60_000) * capacity;
    b.tokens = Math.min(capacity, b.tokens + refill);
    b.ts = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}