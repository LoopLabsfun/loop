// Set the Trigger.dev WORKER env vars (for AGENT_BRAIN=sdk durable sessions) using
// the runtime secret key — the programmatic equivalent of the dashboard's
// Environment Variables page. The tr_prod_… key targets the Production environment.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/trigger-set-env.ts
//
// Re-run after rotating any secret. Values are read from the local env; only the
// KEY NAMES are printed (never the values).
import { envvars } from "@trigger.dev/sdk";

if (!process.env.TRIGGER_SECRET_KEY) {
  console.error("TRIGGER_SECRET_KEY not set (source .env.local).");
  process.exit(1);
}
const need = ["E2B_API_KEY", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "AGENT_TICK_SECRET"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("missing required local env:", missing.join(", "));
  process.exit(1);
}

const variables: Record<string, string> = {
  E2B_API_KEY: process.env.E2B_API_KEY!,
  E2B_TEMPLATE: process.env.E2B_TEMPLATE || "loop-agent",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  AGENT_TICK_SECRET: process.env.AGENT_TICK_SECRET!,
  LOOP_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "https://loop-fun-nine.vercel.app",
};

const PROJECT_REF = process.env.TRIGGER_PROJECT_REF || "proj_xcnutrkjanmeunvpjukz";
const ENV_SLUG = process.env.TRIGGER_ENV_SLUG || "prod"; // tr_prod_… → Production

(async () => {
  try {
    const res = await envvars.upload(PROJECT_REF, ENV_SLUG, {
      variables,
      override: true,
    });
    console.log("✅ uploaded worker env to Trigger.dev:", Object.keys(variables).join(", "));
    console.log("   LOOP_SITE_URL =", variables.LOOP_SITE_URL, "| E2B_TEMPLATE =", variables.E2B_TEMPLATE);
    console.log("   result:", JSON.stringify(res));
  } catch (e) {
    console.error("UPLOAD FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
