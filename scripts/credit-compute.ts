// Record a REAL Anthropic credit purchase against a project's compute_ledger.
//
// There is no Anthropic API for "current available credit" — confirmed against
// the official docs (Usage and Cost API only reports historical $ spend, daily
// granularity, Admin-API-only) and Anthropic support threads. The only way to
// show a genuinely real "remaining" number on the token page (lib/anthropic-cost.ts
// → compute_ledger fallback) is to feed in what was actually paid, each time it's
// paid — there's nothing to poll. The spend side already self-fills for free: the
// agent runtime accumulates real per-call token cost into consumed_usd on every
// tick (lib/agent-runtime.ts, tokensToUsd). This script is the other half: run it
// right after you add funds at platform.claude.com/settings/billing, with the same
// USD amount you just bought.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/credit-compute.ts --amount 30
//   npx tsx scripts/credit-compute.ts --project loop --amount 30   # --project defaults to loop
import { createClient } from "@supabase/supabase-js";
import { recordTopUp, ZERO_LEDGER } from "../lib/compute-rail";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PROJECT_KEY = arg("project", "loop")!;
const AMOUNT = Number(arg("amount"));

(async () => {
  if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) {
    throw new Error("Usage: npx tsx scripts/credit-compute.ts --amount <usd> [--project <key>]");
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error: readErr } = await sb
    .from("compute_ledger")
    .select("credited_usd, consumed_usd")
    .eq("project_key", PROJECT_KEY)
    .maybeSingle();
  if (readErr) throw new Error(`read failed: ${readErr.message}`);

  const before = data
    ? { creditedUsd: Number(data.credited_usd) || 0, consumedUsd: Number(data.consumed_usd) || 0 }
    : ZERO_LEDGER;
  const after = recordTopUp(before, AMOUNT);

  const { error: writeErr } = await sb.from("compute_ledger").upsert({
    project_key: PROJECT_KEY,
    credited_usd: after.creditedUsd,
    consumed_usd: after.consumedUsd,
    updated_at: new Date().toISOString(),
  });
  if (writeErr) throw new Error(`write failed: ${writeErr.message}`);

  console.log(
    `[${PROJECT_KEY}] credited_usd: $${before.creditedUsd.toFixed(2)} -> $${after.creditedUsd.toFixed(2)} ` +
      `(consumed_usd unchanged: $${after.consumedUsd.toFixed(2)})`
  );
})().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
