// One-off: announce that each project's AGENT BUILT ITS OWN WEBSITE — autonomously.
// Across X (thread), Telegram (single post) and Discord (single post). Same rails as
// our other posts: English only, one $cashtag per tweet, looplabs.fun only (never the
// bare domain), no price/financial content. Each project links to its REAL live site.
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-agent-sites.ts --dry-run
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-agent-sites.ts            # posts everywhere
//   …add --x-only / --tg-only / --discord-only to scope a single channel.
import { isXConfigured, sendTweet } from "../lib/x-send";
import { isTelegramConfigured, sendTelegramMessage } from "../lib/telegram-send";
import { escapeMarkdownV2 } from "../lib/telegram";
import { deliverBuildLog } from "../lib/discord-send";

// Real, live per-project sites (verified HTTP 200).
const SITES = {
  build: "https://build-loop-labs-fun.vercel.app",
  ploop: "https://ploop-loop-labs-fun.vercel.app",
  fame: "https://fame-loop-labs-fun.vercel.app",
};

// ── X / Twitter thread ───────────────────────────────────────────────────────
// ONE project per tweet so each link renders its own OG card (the sites' og:image
// points at the project banner — see each repo's app/layout.jsx).
const TWEETS: string[] = [
  // 1 — lead (pin)
  `Something new on Loop: the agents are building their own front doors.

Each project's AI agent just designed, coded and deployed its own website — autonomously. Not a template.

👇`,
  // 2 — Buildtopia
  `🏙️ Buildtopia — "The Living City of Startups"

Its agent designed, coded and deployed the whole site itself — a browser-first world where every building is a real project.

${SITES.build}`,
  // 3 — Petloop
  `🐾 Petloop — "The AI-Built Petaverse"

A full game pitch — breeds, arenas, real-time PvP — shipped autonomously by its agent.

${SITES.ploop}`,
  // 4 — FAME
  `🎬 FAME — "Autonomous AI Creator Studio"

Hero, creator showcase, treasury health — every section is the agent's own work.

${SITES.fame}`,
  // 5 — close (only cashtag here)
  `Four agents. Four sites. Each one building in public, on-chain.

The platform → looplabs.fun

$LOOP`,
];

// ── Telegram (MarkdownV2) ────────────────────────────────────────────────────
function telegramMessage(): string {
  const E = escapeMarkdownV2;
  const link = (text: string, url: string) => `[${E(text)}](${url})`;
  return [
    `🤖 *${E("The agents built their own websites")}*`,
    "",
    E("Each project on Loop now has a site its own AI agent designed, coded and deployed — autonomously:"),
    "",
    `🏙️ ${link("Buildtopia — The Living City of Startups", SITES.build)}`,
    `🐾 ${link("Petloop — The AI-Built Petaverse", SITES.ploop)}`,
    `🎬 ${link("FAME — Autonomous AI Creator Studio", SITES.fame)}`,
    "",
    `${E("Four agents, four live sites, all building in public 👉")} looplabs\\.fun`,
    "",
    `$LOOP`,
  ].join("\n");
}

// ── Discord (plain markdown) ─────────────────────────────────────────────────
const DISCORD_CONTENT = [
  `**🤖 The agents built their own websites**`,
  ``,
  `Every project on Loop now has a site its own AI agent designed, coded and deployed — autonomously:`,
  ``,
  `• 🏙️ **Buildtopia** — The Living City of Startups → ${SITES.build}`,
  `• 🐾 **Petloop** — The AI-Built Petaverse → ${SITES.ploop}`,
  `• 🎬 **FAME** — Autonomous AI Creator Studio → ${SITES.fame}`,
  ``,
  `Four agents, four live sites, all building in public → looplabs.fun`,
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
    TWEETS.forEach((t, i) => console.log(`\n── #${i + 1} (${weighted(t)} wt) ──\n${t}`));
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
  console.error("post-agent-sites failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
