import "server-only";
import { supabaseAdmin } from "./supabase";
import { safeName, vercelConfigured } from "./provisioning";

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT CUSTOM DOMAIN — attach an external domain to a project's Vercel project.
//
// Each project deploys to its own Vercel project (slug = safeName(key), e.g.
// LoopLabsfun/build → vercel project "build" → build-loop-labs-fun.vercel.app).
// A creator (or the LOOP super-admin) can point an external domain at that project
// from the edit surface: we add the domain on Vercel, surface the DNS records the
// owner must set, verify on demand, and — once verified — persist it onto the
// project row (`projects.domain`) so the public UI links to the real domain.
//
// Env-gated + best-effort, same posture as lib/provisioning-exec: no VERCEL_TOKEN
// ⇒ every op returns a clear "unarmed" note instead of throwing. The Vercel project
// name is the SOURCE OF TRUTH for pending domains (we query it live), so the row's
// `domain` only ever holds a VERIFIED domain — an unverified one never becomes the
// public link.
// ─────────────────────────────────────────────────────────────────────────────

const VERCEL = "https://api.vercel.com";

function teamId(): string {
  return process.env.VERCEL_TEAM_ID || "";
}

function vercelHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/** The Vercel project name a project key deploys to (mirrors provisionPlan). */
export function projectVercelProject(key: string): string {
  return safeName(key);
}

/**
 * Normalize a domain input to a bare lowercase hostname, or null if invalid.
 * Strips protocol/path/port and a leading "www." is kept as-is (a user asking for
 * www.foo.com means that host). Rejects *.vercel.app (those are auto-assigned) and
 * anything without a dot. Pure + unit-tested.
 */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let h = input.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  h = h.replace(/\.$/, ""); // trailing dot
  if (h.length < 4 || h.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(h)) return null;
  if (!h.includes(".")) return null;
  if (h.startsWith(".") || h.endsWith(".") || h.includes("..")) return null;
  if (h.startsWith("-") || h.endsWith("-")) return null;
  if (/\.vercel\.app$/.test(h)) return null; // auto domain, not a custom one
  // Each label 1–63 chars, no leading/trailing hyphen.
  if (!h.split(".").every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  return h;
}

/** One DNS record the domain owner must set for verification/routing. */
export interface DomainDnsRecord {
  type: string;
  name: string;
  value: string;
}

export interface ProjectDomain {
  name: string;
  verified: boolean;
  /** Records to set at the DNS provider (apex → A, subdomain → CNAME, plus any
   *  TXT verification challenge Vercel returns). Empty when already verified. */
  dns: DomainDnsRecord[];
}

export interface DomainResult {
  ok: boolean;
  note: string;
  /** All custom domains currently on the project's Vercel project. */
  domains: ProjectDomain[];
}

/** Recommended DNS for a host: apex (one label before TLD heuristic) → A record,
 *  otherwise CNAME. Vercel's own `verification` challenges are merged on top. */
function baseDnsFor(host: string): DomainDnsRecord[] {
  const labels = host.split(".");
  const isApex = labels.length <= 2; // foo.com = apex; www.foo.com / a.b.co = sub
  return isApex
    ? [{ type: "A", name: "@", value: "76.76.21.21" }]
    : [{ type: "CNAME", name: labels[0], value: "cname.vercel-dns.com" }];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toDomain(host: string, d: any): ProjectDomain {
  const verified = Boolean(d?.verified);
  const challenges: DomainDnsRecord[] = Array.isArray(d?.verification)
    ? d.verification
        .filter((v: any) => v?.type && v?.value)
        .map((v: any) => ({ type: String(v.type), name: String(v.domain ?? "@"), value: String(v.value) }))
    : [];
  return {
    name: host,
    verified,
    dns: verified ? [] : [...baseDnsFor(host), ...challenges],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** List the custom domains on a project's Vercel project (live). Best-effort. */
export async function listProjectDomains(key: string): Promise<DomainResult> {
  if (!vercelConfigured()) return { ok: false, note: "domains unarmed (VERCEL_TOKEN/TEAM unset)", domains: [] };
  const slug = projectVercelProject(key);
  try {
    const r = await fetch(`${VERCEL}/v9/projects/${slug}/domains?teamId=${encodeURIComponent(teamId())}`, {
      headers: vercelHeaders(),
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, note: `list failed (${r.status})`, domains: [] };
    const j = (await r.json()) as { domains?: unknown[] };
    const all = (j.domains ?? []) as Record<string, unknown>[];
    // Hide the auto-assigned *.vercel.app domains; only show real custom ones.
    const custom = all
      .filter((d) => typeof d.name === "string" && !/\.vercel\.app$/.test(d.name as string))
      .map((d) => toDomain(d.name as string, d));
    return { ok: true, note: "ok", domains: custom };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "list error", domains: [] };
  }
}

/** Attach a custom domain to the project's Vercel project. Idempotent-ish: a domain
 *  already on the project is treated as success. Returns the live domain list. */
export async function attachProjectDomain(key: string, input: unknown): Promise<DomainResult> {
  if (!vercelConfigured()) return { ok: false, note: "domains unarmed (VERCEL_TOKEN/TEAM unset)", domains: [] };
  const host = normalizeDomain(input);
  if (!host) return { ok: false, note: "invalid domain", domains: [] };
  const slug = projectVercelProject(key);
  try {
    const r = await fetch(`${VERCEL}/v10/projects/${slug}/domains?teamId=${encodeURIComponent(teamId())}`, {
      method: "POST",
      headers: vercelHeaders(),
      cache: "no-store",
      body: JSON.stringify({ name: host }),
    });
    if (!r.ok && r.status !== 409) {
      const body = await r.text();
      // 409 = already attached (fine); anything else is a real error.
      return { ok: false, note: `attach failed (${r.status}): ${body.slice(0, 160)}`, domains: (await listProjectDomains(key)).domains };
    }
    const status = await listProjectDomains(key);
    // If Vercel says it's already verified (rare: pre-pointed DNS), persist now.
    const d = status.domains.find((x) => x.name === host);
    if (d?.verified) await persistVerifiedDomain(key, host);
    return { ok: true, note: r.status === 409 ? "domain already attached" : "domain attached — set the DNS below, then verify", domains: status.domains };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "attach error", domains: [] };
  }
}

/** Ask Vercel to re-check a domain's DNS. On success, persist it onto the row. */
export async function verifyProjectDomain(key: string, input: unknown): Promise<DomainResult> {
  if (!vercelConfigured()) return { ok: false, note: "domains unarmed (VERCEL_TOKEN/TEAM unset)", domains: [] };
  const host = normalizeDomain(input);
  if (!host) return { ok: false, note: "invalid domain", domains: [] };
  const slug = projectVercelProject(key);
  try {
    await fetch(`${VERCEL}/v9/projects/${slug}/domains/${host}/verify?teamId=${encodeURIComponent(teamId())}`, {
      method: "POST",
      headers: vercelHeaders(),
      cache: "no-store",
    });
    const status = await listProjectDomains(key);
    const d = status.domains.find((x) => x.name === host);
    if (d?.verified) {
      await persistVerifiedDomain(key, host);
      return { ok: true, note: "verified — domain is live", domains: status.domains };
    }
    return { ok: false, note: "not verified yet — DNS may still be propagating", domains: status.domains };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "verify error", domains: [] };
  }
}

/** Remove a domain from the project's Vercel project + clear the row if it matched. */
export async function detachProjectDomain(key: string, input: unknown): Promise<DomainResult> {
  if (!vercelConfigured()) return { ok: false, note: "domains unarmed (VERCEL_TOKEN/TEAM unset)", domains: [] };
  const host = normalizeDomain(input);
  if (!host) return { ok: false, note: "invalid domain", domains: [] };
  const slug = projectVercelProject(key);
  try {
    await fetch(`${VERCEL}/v9/projects/${slug}/domains/${host}?teamId=${encodeURIComponent(teamId())}`, {
      method: "DELETE",
      headers: vercelHeaders(),
      cache: "no-store",
    });
    await clearDomainIfMatches(key, host);
    return { ok: true, note: "domain removed", domains: (await listProjectDomains(key)).domains };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "detach error", domains: [] };
  }
}

/** Persist a VERIFIED domain onto the project row (the public link uses it). */
async function persistVerifiedDomain(key: string, host: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) return;
  await sb.from("projects").update({ domain: host }).eq("key", key);
}

/** Clear the row's domain if it equals the one being removed. */
async function clearDomainIfMatches(key: string, host: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) return;
  await sb.from("projects").update({ domain: null }).eq("key", key).eq("domain", host);
}
