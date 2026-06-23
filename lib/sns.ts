import "server-only";

// Solana Name Service (.sol) reverse resolution: wallet address → its primary
// (.sol) domain, so holders/trades/treasury show human names instead of raw
// base58. Dependency-free like lib/solana.ts — we hit Bonfida's public SNS-SDK
// proxy over fetch rather than pulling in @bonfida/spl-name-service (a CJS/ESM
// hybrid that fights Next's server bundling). Best-effort: any failure or an
// unnamed wallet returns null and callers fall back to a short address.

const PROXY = "https://sns-sdk-proxy.bonfida.workers.dev";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Names change rarely; cache resolved entries (including misses) so the
// force-dynamic token page doesn't refetch per request. A shorter TTL for misses
// lets a newly-set name appear within the hour.
const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; name: string | null }>();

function cached(addr: string): string | null | undefined {
  const e = cache.get(addr);
  if (!e) return undefined;
  const ttl = e.name ? HIT_TTL_MS : MISS_TTL_MS;
  if (Date.now() - e.at > ttl) return undefined;
  return e.name;
}

/** Normalize one proxy result entry (string | {domain|reverse} | null) → ".sol" name. */
function toName(entry: unknown): string | null {
  const raw =
    typeof entry === "string"
      ? entry
      : entry && typeof entry === "object"
        ? ((entry as Record<string, unknown>).domain ??
            (entry as Record<string, unknown>).reverse) as string | undefined
        : undefined;
  if (!raw || typeof raw !== "string") return null;
  const clean = raw.trim().replace(/\.sol$/i, "");
  if (!clean) return null;
  return `${clean}.sol`;
}

/**
 * Resolve many wallet addresses to their primary `.sol` name in one batch. Returns
 * a Map address→(name|null). Cached per address; only uncached/expired ones are
 * fetched. Never throws — on any error the unresolved addresses map to null.
 */
export async function resolveSnsNames(
  addresses: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const need: string[] = [];
  for (const a of addresses) {
    if (!a || !BASE58.test(a) || out.has(a)) continue;
    const c = cached(a);
    if (c !== undefined) out.set(a, c);
    else need.push(a);
  }
  if (need.length === 0) return out;

  try {
    const res = await fetch(
      `${PROXY}/multiple-favorite-domains/${need.join(",")}`,
      { cache: "no-store" }
    );
    const json = res.ok ? await res.json() : null;
    const arr: unknown[] = Array.isArray(json?.result) ? json.result : [];
    need.forEach((addr, i) => {
      const name = toName(arr[i]);
      cache.set(addr, { at: Date.now(), name });
      out.set(addr, name);
    });
  } catch {
    // Leave the needed addresses unresolved (null) without caching the failure,
    // so a transient outage retries next request.
    for (const a of need) if (!out.has(a)) out.set(a, null);
  }
  return out;
}

/** Resolve a single address to its `.sol` name, or null. */
export async function resolveSnsName(address: string): Promise<string | null> {
  return (await resolveSnsNames([address])).get(address) ?? null;
}
