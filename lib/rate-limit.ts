import "server-only";
import { NextResponse } from "next/server";

// Lightweight fixed-window rate limiter for the social write/read routes. In-memory
// per serverless instance — not a global guarantee (a burst can spread across
// instances), but it cheaply absorbs the common case (one client hammering one
// endpoint) without a Redis dependency. For hard global limits, move the bucket to
// a shared store later; the call sites won't change.

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

/** Pure check: is `key` within `limit` hits per `windowMs`? Mutates the bucket. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  // Opportunistic sweep so the map can't grow unbounded across many keys.
  if (buckets.size > 5000) {
    buckets.forEach((b, k) => {
      if (now > b.resetAt) buckets.delete(k);
    });
  }
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  b.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** Identify the caller: the signed-in wallet when known (most precise), else IP. */
export function clientKey(req: Request, wallet?: string | null): string {
  if (wallet) return `w:${wallet}`;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

/** Apply a limit and return a 429 response when exceeded, else null (proceed). */
export function limited(
  bucket: string,
  req: Request,
  opts: { wallet?: string | null; limit: number; windowMs: number }
): NextResponse | null {
  const { ok, retryAfter } = rateLimit(`${bucket}:${clientKey(req, opts.wallet)}`, opts.limit, opts.windowMs);
  if (ok) return null;
  return NextResponse.json(
    { error: "slow down — too many requests" },
    { status: 429, headers: { "retry-after": String(retryAfter) } }
  );
}
