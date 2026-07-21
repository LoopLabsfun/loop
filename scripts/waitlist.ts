// ─────────────────────────────────────────────────────────────────────────────
// waitlist — read the launch waitlist (app/waitlist + the LaunchModal closed-state).
//
//   npm run waitlist            # pretty terminal view, newest first
//   npm run waitlist -- --csv   # CSV to stdout (pipe to a file for outreach)
//   npm run waitlist -- --ideas # only signups that left an idea (the gold)
//   npm run waitlist -- --limit=50
//
// The launch_waitlist table is RLS-locked with NO read policy, so it's only
// readable via the service role — this script reads it with SUPABASE_SERVICE_ROLE_KEY
// from .env.local. Read-only; it never writes. Standalone (loads .env.local itself,
// no `server-only` imports) so it runs as a plain `tsx` script.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── tiny .env.local loader ──
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* rely on the ambient environment */
  }
}
loadEnv();

// ── args ──
const args = process.argv.slice(2);
const CSV = args.includes("--csv");
const IDEAS_ONLY = args.includes("--ideas");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = Math.max(1, Number(limitArg?.split("=")[1] ?? 500) || 500);

// ── ANSI ──
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
};
const c = (color: keyof typeof C, s: string) => `${C[color]}${s}${C.reset}`;

interface Row {
  id: number;
  wallet: string | null;
  email: string | null;
  x_handle: string | null;
  idea: string | null;
  referrer: string | null;
  name: string | null;
  ticker: string | null;
  status: string | null;
  prompt: string | null;
  repo: string | null;
  fee_founder_pct: number | null;
  banner_url: string | null;
  token_image_url: string | null;
  created_at: string;
}

// founder/agent/platform from the single founder lever (platform fixed at 5).
const splitOf = (founderPct: number | null) => {
  const f = founderPct ?? 30;
  return `${f}/${100 - 5 - f}/5`;
};

const short = (s: string | null, n = 4) =>
  s && s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s ?? "";

const csvCell = (s: string | null) => {
  const v = s ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      c("red", "Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local"),
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let q = sb
    .from("launch_waitlist")
    .select(
      "id, wallet, email, x_handle, idea, referrer, name, ticker, status, prompt, repo, fee_founder_pct, banner_url, token_image_url, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (IDEAS_ONLY) q = q.not("idea", "is", null);

  const { data, error } = await q;
  if (error) {
    console.error(c("red", `Query failed: ${error.message}`));
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  if (CSV) {
    console.log("created_at,name,ticker,status,wallet,email,x_handle,prompt,repo,fee_split,banner_url,token_image_url,referrer");
    for (const r of rows) {
      console.log(
        [
          r.created_at, r.name, r.ticker, r.status, r.wallet, r.email, r.x_handle,
          r.prompt, r.repo, splitOf(r.fee_founder_pct), r.banner_url, r.token_image_url, r.referrer,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    return;
  }

  // ── pretty view ──
  const total = rows.length;
  const withDraft = rows.filter((r) => r.name).length;
  const withWallet = rows.filter((r) => r.wallet).length;
  const withEmail = rows.filter((r) => r.email).length;
  const withX = rows.filter((r) => r.x_handle).length;

  console.log("");
  console.log(c("bold", "  LAUNCH WAITLIST") + c("gray", "  ·  looplabs.fun/waitlist"));
  console.log(
    c(
      "gray",
      `  ${total} signup${total === 1 ? "" : "s"}  ·  ${withDraft} draft  ·  ${withWallet} wallet  ·  ${withEmail} email  ·  ${withX} X`,
    ),
  );
  console.log("");

  if (total === 0) {
    console.log(c("dim", "  No signups yet."));
    console.log("");
    return;
  }

  for (const r of rows) {
    const when = new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ");
    const contacts = [
      r.x_handle ? c("cyan", `@${r.x_handle}`) : "",
      r.email ? c("green", r.email) : "",
      r.wallet ? c("yellow", short(r.wallet)) : "",
    ]
      .filter(Boolean)
      .join("  ");
    // Header line: the project (name + $ticker + status) when this is a draft.
    const title = r.name
      ? `${c("bold", r.name)} ${c("cyan", `$${r.ticker ?? "?"}`)} ${c("gray", `[${r.status ?? "draft"}]`)}`
      : c("dim", "(no draft)");
    console.log(`  ${c("gray", when)}  ${title}`);
    console.log(`    ${contacts || c("dim", "no contact")}`);
    if (r.prompt) console.log(`    ${c("dim", "↳ build:")} ${r.prompt}`);
    if (r.repo) console.log(`    ${c("dim", "↳ repo:")} ${r.repo}`);
    if (r.name) console.log(`    ${c("dim", `↳ split ${splitOf(r.fee_founder_pct)} (founder/agent/platform)`)}`);
    const media = [r.banner_url ? "banner" : "", r.token_image_url ? "token-img" : ""].filter(Boolean).join(" + ");
    if (media) console.log(`    ${c("dim", `↳ media: ${media}`)}`);
    if (r.idea && !r.prompt) console.log(`    ${c("dim", "↳")} ${r.idea}`);
    if (r.referrer) console.log(`    ${c("gray", `via ${short(r.referrer)}`)}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(c("red", String(e?.message ?? e)));
  process.exit(1);
});
