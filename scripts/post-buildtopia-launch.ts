// One-off: announce BUILDTOPIA going LIVE ($BUILD) + the whitelisted projects in
// pre-launch on looplabs.fun, across X (thread), Telegram (single post) and
// Discord (single post). Same rails as our other posts: English only, one
// $cashtag per tweet, looplabs.fun only (never the bare domain), no price content.
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-buildtopia-launch.ts --dry-run
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-buildtopia-launch.ts            # posts everywhere
//   …add --x-only / --tg-only / --discord-only to scope a single channel.
import { isXConfigured, sendTweet } from "../lib/x-send";
import { isTelegramConfigured, sendTelegramMessage } from "../lib/telegram-send";
import { escapeMarkdownV2 } from "../lib/telegram";
import { deliverBuildLog } from "../lib/discord-send";

const CA = "4wPKu28eBdEJWp1E5gw136aax8cbCUtuEPTohCdLoop";
const PUMP_URL = `https://pump.fun/coin/${CA}`;

// ── X / Twitter thread ───────────────────────────────────────────────────────
const TWEETS: string[] = [
  // 1 — lead (pin): Buildtopia is live
  `🏙️ Buildtopia is LIVE — the living world of Loop.

A 3D city where every building is a real startup launched on Loop, grown by its own AI agent.

$BUILD
CA: ${CA}

${PUMP_URL}`,
  // 2 — the factory keeps running (whitelisted projects)
  `🏭 The Loop factory keeps running.

FAME (autonomous AI creator studio) and Petloop (3D pet PvP) are in pre-launch right now — back the ones you believe in. Your SOL is the opening candle, refundable until they launch.

👉 looplabs.fun`,
];

// ── Telegram (MarkdownV2) ────────────────────────────────────────────────────
function telegramMessage(): string {
  const E = escapeMarkdownV2;
  return [
    `🏙️ *${E("Buildtopia is LIVE — the living world of Loop")}*`,
    "",
    E("A 3D city where every building is a real startup launched on Loop, grown by its own AI agent."),
    "",
    `$BUILD`,
    `CA: \`${CA}\``,
    `${E("Trade →")} ${E(PUMP_URL)}`,
    "",
    `🏭 ${E("The factory keeps running — FAME and Petloop are in pre-launch. Back them on")} looplabs\\.fun`,
  ].join("\n");
}

// ── Discord (plain markdown) ─────────────────────────────────────────────────
const DISCORD_CONTENT = [
  `**🏙️ Buildtopia is LIVE — the living world of Loop**`,
  ``,
  `A 3D city where every building is a real startup launched on Loop, grown by its own AI agent.`,
  ``,
  `**$BUILD**`,
  `CA: \`${CA}\``,
  `Trade → ${PUMP_URL}`,
  ``,
  `🏭 The factory keeps running — **FAME** and **Petloop** are in pre-launch. Back them → looplabs.fun`,
].join("\n");

// ── Runner ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = {
  x: args.includes("--x-only"),
  tg: args.includes("--tg-only"),
  discord: args.includes("--discord-only"),
};
const all = !only.x && !only.tg && !only.discord;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function weighted(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  let len = text.length;
  for (const u of urls) len += 23 - u.length; // X counts every URL as 23 (t.co)
  return len;
}

(async () => {
  // Guard rails: ≤1 cashtag and ≤280 weighted chars per tweet.
  const bad = TWEETS.map((t, i) => ({ i, cash: (t.match(/\$[A-Za-z]/g) ?? []).length, len: weighted(t) }))
    .filter((x) => x.cash > 1 || x.len > 280);
  if (bad.length) {
    bad.forEach((x) => console.error(`✗ tweet #${x.i + 1}: cashtags=${x.cash} weightedLen=${x.len}`));
    process.exit(1);
  }

  if (dryRun) {
    console.log("DRY RUN — nothing posted.\n");
    console.log("──────── X THREAD ────────");
    TWEETS.forEach((t, i) => console.log(`\n── #${i + 1} (${weighted(t)} wt, ${(t.match(/\$[A-Za-z]/g) ?? []).length} cashtag) ──\n${t}`));
    console.log("\n──────── TELEGRAM (MarkdownV2) ────────\n" + telegramMessage());
    console.log("\n──────── DISCORD ────────\n" + DISCORD_CONTENT);
    return;
  }

  // X thread (chained replies).
  if (all || only.x) {
    if (!isXConfigured()) {
      console.error("❌ X not configured (X_API_KEY/SECRET + X_ACCESS_TOKEN/SECRET).");
    } else {
      let prev: string | undefined;
      for (let i = 0; i < TWEETS.length; i++) {
        const r = await sendTweet(TWEETS[i], prev);
        if (!r.ok) {
          console.error(`❌ tweet #${i + 1} failed: ${r.error}`);
          if (prev) console.error(`   thread root: https://x.com/looplabsfun/status/${prev}`);
          break;
        }
        console.log(`✅ X #${i + 1} → https://x.com/looplabsfun/status/${r.id}`);
        prev = r.id;
        if (i < TWEETS.length - 1) await sleep(2500);
      }
    }
  }

  // Telegram broadcast channel.
  if (all || only.tg) {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!isTelegramConfigured() || !chatId) {
      console.error("❌ Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).");
    } else {
      const r = await sendTelegramMessage(chatId, telegramMessage());
      if (r.ok) console.log(`✅ Telegram → chat ${chatId}`);
      else console.error(`❌ Telegram failed (${r.errorCode ?? "?"}): ${r.error}`);
    }
  }

  // Discord build-log channel (bot) or webhook fallback.
  if (all || only.discord) {
    const r = await deliverBuildLog({ content: DISCORD_CONTENT, allowed_mentions: { parse: [] } });
    if (r.ok) console.log("✅ Discord → build-log");
    else if (r.skipped) console.error("❌ Discord not configured (webhook/bot).");
    else console.error(`❌ Discord failed (${r.status ?? "?"}): ${r.error}`);
  }
})().catch((e) => {
  console.error("post-buildtopia-launch failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
