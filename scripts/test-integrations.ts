// Live integration smoke test: Telegram, Resend email, and one real agent tick.
// Each is isolated — a failure in one doesn't stop the others. Reads keys from
// .env.local. Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/test-integrations.ts
import { sendTelegramMessage, isTelegramConfigured } from "../lib/telegram-send";
import { sendAgentEmail, isEmailConfigured, agentFrom } from "../lib/email-send";
import { getProject } from "../lib/queries";
import { runAgentTick, agentRuntimeConfigured } from "../lib/agent-runtime";

const EMAIL_TO = process.env.TEST_EMAIL_TO || "contact@looplabs.fun";
const LOOP = { key: "loop", ticker: "$LOOP" } as const;

async function testTelegram() {
  console.log("\n── TELEGRAM ──");
  if (!isTelegramConfigured()) return console.log("⏭️  not configured");
  const r = await sendTelegramMessage(
    process.env.TELEGRAM_CHAT_ID as string,
    "Loop integration test ping " + new Date().toISOString().replace(/[:.]/g, " ")
  );
  console.log(r.ok ? "✅ sent — check the Telegram chat" : `❌ failed: ${JSON.stringify(r)}`);
}

async function testEmail() {
  console.log("\n── RESEND EMAIL ──");
  if (!isEmailConfigured()) return console.log("⏭️  not configured");
  console.log(`from: ${agentFrom(LOOP)}  →  to: ${EMAIL_TO}`);
  const r = await sendAgentEmail(LOOP, {
    to: EMAIL_TO,
    subject: "Loop email integration test",
    text: "If you received this, Resend is wired and the agent can email.",
  });
  console.log(
    r.ok
      ? "✅ accepted by Resend — check the inbox"
      : `❌ failed: ${JSON.stringify(r)}  (often = sender domain not verified in Resend)`
  );
}

async function testAgent() {
  console.log("\n── AGENT TICK (real Claude call) ──");
  if (!agentRuntimeConfigured()) return console.log("⏭️  ANTHROPIC_API_KEY not set");
  const p = await getProject("loop");
  if (!p) return console.log("❌ LOOP project not found");
  try {
    const decision = await runAgentTick(p, { tasks: [], directives: [] });
    console.log("✅ agent decided + persisted:");
    console.log("   summary:", decision.summary);
    console.log("   task:   ", `[${decision.task.status}] (${decision.task.category}) ${decision.task.title}`);
  } catch (e) {
    console.log("❌ tick failed:", e instanceof Error ? e.message : e);
  }
}

(async () => {
  await testTelegram();
  await testEmail();
  await testAgent();
  console.log("\n(X is not testable yet — no X_API_* keys and no send path.)");
})();
