import { BURST, CLOSE_AFTER_DROPPED, RATE_PER_SEC } from "./config";

export interface Bucket {
  tokens: number;
  at: number;
  dropped: number;
}

export type Verdict = "ok" | "drop" | "close";

export function newBucket(now: number): Bucket {
  return { tokens: BURST, at: now, dropped: 0 };
}

/** Spend one token. "drop" = ignore this message; "close" = kick the socket. */
export function take(bucket: Bucket, now: number): Verdict {
  bucket.tokens = Math.min(BURST, bucket.tokens + ((now - bucket.at) / 1000) * RATE_PER_SEC);
  bucket.at = now;
  if (bucket.tokens < 1) {
    bucket.dropped += 1;
    return bucket.dropped >= CLOSE_AFTER_DROPPED ? "close" : "drop";
  }
  bucket.tokens -= 1;
  return "ok";
}