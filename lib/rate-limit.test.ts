import { describe, it, expect, vi, afterEach } from "vitest";
import { rateLimit, clientKey, limited } from "./rate-limit";

afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows up to the limit, then blocks with a retry-after", () => {
    const key = `k-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 1000).ok).toBe(true);
    const blocked = rateLimit(key, 3, 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const key = "window-key";
    expect(rateLimit(key, 1, 1000).ok).toBe(true);
    expect(rateLimit(key, 1, 1000).ok).toBe(false); // still in window
    vi.setSystemTime(1500); // past the 1s window
    expect(rateLimit(key, 1, 1000).ok).toBe(true);
  });

  it("keeps separate counters per key", () => {
    expect(rateLimit("a-key", 1, 1000).ok).toBe(true);
    expect(rateLimit("b-key", 1, 1000).ok).toBe(true); // different key, own bucket
    expect(rateLimit("a-key", 1, 1000).ok).toBe(false);
  });
});

describe("clientKey", () => {
  it("prefers the wallet when known (most precise)", () => {
    expect(clientKey(new Request("http://x"), "WALLET123")).toBe("w:WALLET123");
  });

  it("falls back to the first x-forwarded-for IP", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientKey(req)).toBe("ip:1.2.3.4");
  });

  it("uses x-real-ip when no forwarded header, else 'unknown'", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("ip:9.9.9.9");
    expect(clientKey(new Request("http://x"))).toBe("ip:unknown");
  });
});

describe("limited", () => {
  it("returns null under the limit and a 429 over it", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": `ip-${Math.random()}` } });
    expect(limited("bucket", req, { limit: 1, windowMs: 1000 })).toBeNull();
    const res = limited("bucket", req, { limit: 1, windowMs: 1000 });
    expect(res?.status).toBe(429);
    expect(res?.headers.get("retry-after")).toBeTruthy();
  });
});
