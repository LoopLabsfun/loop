// One-off: announce a Loop project going LIVE on pump.fun across X (thread),
// Telegram (single post) and Discord (single post) — the same treatment
// Buildtopia got (scripts/post-buildtopia-launch.ts). Posts to the shared Loop
// brand channels (@looplabsfun / Loop TG channel / Discord build-log).
//
// Same rails as every Loop post: English only, ≤1 $cashtag per tweet,
// looplabs.fun only (never the bare domain), no price/financial content.
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-project-launch.ts --project=ploop --dry-run
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-project-launch.ts --project=fame
//   …add --x-only / --tg-only / --discord-only to scope a single channel.
import { isXConfigured, sendTweet } from "../lib/x-send";
import { isTelegramConfigured, sendTelegramMessage } from "../lib/telegram-send";
import { escapeMarkdownV2 } from "../lib/telegram";
import { deliverBuildLog } from "../lib/discord-send";

interface ProjectPost {
  name: string;
  ticker: string; // includes the $
  ca: string;
  emoji: string;
  lead: string; // one-line pitch, kept short so tweet 1 stays < 280 weighted
}

const PROJECTS: Record<string, ProjectPost> = {
  ploop: {
    name: "Petloop",
    ticker: "$PLOOP",
    ca: "7rvTGir5bCTrA1vpm1zcuMRS7j9kbrVc8FZXDvVLoop",
    emoji: "🐶",
    lead: "A Three.js browser game where dog breeds battle head-to-head in real-time PvP arenas. Built, balanced and grown entirely by its own AI agent.",
  },
  fame: {
    name: "FAME",
    ticker: "$FAME",
    ca: "8QPobauCKX3QPgN3Mr3mjxDwjfcGJKLj9x79tuXLoop",
    emoji: "🎬",
    lead: "The AI creates and manages virtual creators, produces content and grows audiences — building a real revenue company with no human employees.",
  },
};

function buildContent(p: ProjectPost) {
  const pumpUrl = `https://pump.fun/coin/${p.ca}`;

  const tweets: string[] = [
    // 1 — lead (pin): the project is live
    `${p.emoji} ${p.name} is LIVE — built by Loop.

${p.lead}

${p.ticker}
CA: ${p.ca}

${pumpUrl}`,
    // 2 — the factory keeps running (no cashtag here)
    `🏭 Another one from the Loop factory.

Every project is a token + on-chain treasury + its own AI agent that builds it in public. ${p.name} just went live — back the build and watch it ship.

👉 looplabs.fun`,
  ];

  const E = escapeMarkdownV2;
  const telegram = [
    `${p.emoji} *${E(`${p.name} is LIVE — built by Loop`)}*`,
    "",
    E(p.lead),
    "",
    `${p.ticker}`,
    `CA: \`${p.ca}\``,
    `${E("Trade →")} ${E(pumpUrl)}`,
    "",
    `🏭 ${E("Another one from the Loop factory — a token, a treasury and its own AI agent building in public. More on")} looplabs\\.fun`,
  ].join("\n");

  const discord = [
    `**${p.emoji} ${p.name} is LIVE — built by Loop**`,
    ``,
    p.lead,
    ``,
    `**${p.ticker}**`,
    `CA: \`${p.ca}\``,
    `Trade → ${pumpUrl}`,
    ``,
    `🏭 Another one from the Loop factory — a token, a treasury and its own AI agent building in public. More → looplabs.fun`,
  ].join("\n");

  return { tweets, telegram, discord };
}

// ── Runner ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const projectArg = (args.find((a) => a.startsWith("--project=")) ?? "").split("=")[1];
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
  const p = PROJECTS[projectArg];
  if (!p) {
    console.error(`❌ pass --project=<${Object.keys(PROJECTS).join("|")}>`);
    process.exit(1);
  }
  const { tweets, telegram, discord } = buildContent(p);

  // Guard rails: ≤1 cashtag and ≤280 weighted chars per tweet.
  const bad = tweets
    .map((t, i) => ({ i, cash: (t.match(/\$[A-Za-z]/g) ?? []).length, len: weighted(t) }))
    .filter((x) => x.cash > 1 || x.len > 280);
  if (bad.length) {
    bad.forEach((x) => console.error(`✗ tweet #${x.i + 1}: cashtags=${x.cash} weightedLen=${x.len}`));
    process.exit(1);
  }

  if (dryRun) {
    console.log(`DRY RUN — ${p.name} — nothing posted.\n`);
    console.log("──────── X THREAD ────────");
    tweets.forEach((t, i) =>
      console.log(`\n── #${i + 1} (${weighted(t)} wt, ${(t.match(/\$[A-Za-z]/g) ?? []).length} cashtag) ──\n${t}`)
    );
    console.log("\n──────── TELEGRAM (MarkdownV2) ────────\n" + telegram);
    console.log("\n──────── DISCORD ────────\n" + discord);
    return;
  }

  // X thread (chained replies).
  if (all || only.x) {
    if (!isXConfigured()) {
      console.error("❌ X not configured (X_API_KEY/SECRET + X_ACCESS_TOKEN/SECRET).");
    } else {
      let prev: string | undefined;
      for (let i = 0; i < tweets.length; i++) {
        const r = await sendTweet(tweets[i], prev);
        if (!r.ok) {
          console.error(`❌ tweet #${i + 1} failed: ${r.error}`);
          if (prev) console.error(`   thread root: https://x.com/looplabsfun/status/${prev}`);
          break;
        }
        console.log(`✅ X #${i + 1} → https://x.com/looplabsfun/status/${r.id}`);
        prev = r.id;
        if (i < tweets.length - 1) await sleep(2500);
      }
    }
  }

  // Telegram broadcast channel.
  if (all || only.tg) {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!isTelegramConfigured() || !chatId) {
      console.error("❌ Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).");
    } else {
      const r = await sendTelegramMessage(chatId, telegram);
      if (r.ok) console.log(`✅ Telegram → chat ${chatId}`);
      else console.error(`❌ Telegram failed (${r.errorCode ?? "?"}): ${r.error}`);
    }
  }

  // Discord build-log channel (bot) or webhook fallback.
  if (all || only.discord) {
    const r = await deliverBuildLog({ content: discord, allowed_mentions: { parse: [] } });
    if (r.ok) console.log("✅ Discord → build-log");
    else if (r.skipped) console.error("❌ Discord not configured (webhook/bot).");
    else console.error(`❌ Discord failed (${r.status ?? "?"}): ${r.error}`);
  }
})().catch((e) => {
  console.error("post-project-launch failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
