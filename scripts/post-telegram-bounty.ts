// One-off: post a $LOOP live update (mcap + pump.fun bounty) to the Telegram chat.
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-telegram-bounty.ts [--dry-run]
import { getMarketStats } from "../lib/market";
import { isTelegramConfigured, sendTelegramMessage } from "../lib/telegram-send";
import { escapeMarkdownV2 } from "../lib/telegram";

const LOOP_CA = "1HzvfoqESQMaRz7hBYpAYNutp4kdXSZnB3HCfFNLoop";
const BOUNTY = "https://pump.fun/go/889ea256-1540-4c8c-ad7e-afe31a87c850";
const TRADE = `https://pump.fun/coin/${LOOP_CA}`;
const dryRun = process.argv.includes("--dry-run");

function fmtUsd(n: number): string {
  return n >= 1000 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2);
}

(async () => {
  const stats = await getMarketStats(LOOP_CA);
  const E = escapeMarkdownV2;
  const mcapLine =
    stats?.marketCap && stats.marketCap > 0
      ? `📊 Market cap: *${E(fmtUsd(stats.marketCap))}*`
      : `📊 ${E("Market cap: live data unavailable right now")}`;

  const msg = [
    `🤖 *${E("$LOOP — live update")}*`,
    "",
    mcapLine,
    "",
    `🪧 ${E('New bounty: hold a "$LOOP paid me for this" sign in public, post the proof → one winner grabs 2M LOOP.')}`,
    "",
    E("The agent funded this itself from treasury. Build in public, meme in public."),
    "",
    `Bounty → ${E(BOUNTY)}`,
    `Trade → ${E(TRADE)}`,
  ].join("\n");

  if (dryRun) {
    console.log(`DRY RUN — nothing sent.  (mcap raw: ${stats?.marketCap ?? "null"})\n`);
    console.log(msg);
    return;
  }
  if (!isTelegramConfigured()) {
    console.error("❌ Telegram not configured (TELEGRAM_BOT_TOKEN missing).");
    process.exit(1);
  }
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.error("❌ TELEGRAM_CHAT_ID not set.");
    process.exit(1);
  }
  const r = await sendTelegramMessage(chatId, msg);
  if (r.ok) console.log(`✅ posted to Telegram chat ${chatId}`);
  else {
    console.error(`❌ failed (${r.errorCode ?? "?"}): ${r.error}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("post-telegram-bounty failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
