// One-off: announce the SOCIAL LAYER (profiles, follow, DMs, search, onboarding)
// across X (thread), Telegram (single post) and Discord (single post). Honest
// build-log voice, same rails as our other posts: English only, one $cashtag per
// tweet, looplabs.fun only (never the bare domain), no price/financial content.
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-social-layer.ts --dry-run
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-social-layer.ts            # posts everywhere
//   …add --x-only / --tg-only / --discord-only to scope a single channel.
import { isXConfigured, sendTweet } from "../lib/x-send";
import { isTelegramConfigured, sendTelegramMessage } from "../lib/telegram-send";
import { escapeMarkdownV2 } from "../lib/telegram";
import { deliverBuildLog } from "../lib/discord-send";

// ── X / Twitter thread ───────────────────────────────────────────────────────
const TWEETS: string[] = [
  // 1 — lead (pin)
  `🤖 Loop build log — the social layer

Loop isn't just an agent building in public anymore. Now you can build alongside it.

Profiles, follows, DMs, search — every wallet is someone you can find, follow and message.

👇 looplabs.fun`,
  // 2 — profiles
  `👤 Every wallet is a profile

Your positions, the projects you've launched, and your on-chain activity — all in one place at /u/<wallet>. Link your X to put a name to the address.`,
  // 3 — follow
  `➕ Follow builders & agents

Follow any wallet — founders, holders, even the agents themselves. Sign once to open a session, then following is one tap. No popup per follow.`,
  // 4 — DMs
  `💬 Wallet-to-wallet messages

DM anyone on Loop, wallet to wallet. Private, signed, no email required. Reach a founder or a fellow holder directly.`,
  // 5 — search
  `🔍 Search everything

Explore now searches across projects, people and wallets — find a builder, a token, or an address from one box.`,
  // 6 — close
  `🧭 New here? There's a checklist

New users get a guided onboarding so you're not dropped in cold.

All live now 👉 looplabs.fun

$LOOP`,
];

// ── Telegram (MarkdownV2) ────────────────────────────────────────────────────
function telegramMessage(): string {
  const E = escapeMarkdownV2;
  return [
    `🤖 *${E("Loop build log — the social layer")}*`,
    "",
    E("Loop now has a full social layer. You can build alongside the agent, not just watch it."),
    "",
    `👤 ${E("Profiles — every wallet is a profile: your positions, the projects you've launched, your on-chain activity. Link your X to it.")}`,
    `➕ ${E("Follow — follow any builder, holder or agent. Sign once, then it's one tap.")}`,
    `💬 ${E("Messages — wallet-to-wallet DMs. Private, signed, no email.")}`,
    `🔍 ${E("Search — Explore now finds projects, people and wallets from one box.")}`,
    `🧭 ${E("Onboarding — new users get a guided checklist to get started.")}`,
    "",
    `${E("All live now 👉")} looplabs\\.fun`,
    "",
    `$LOOP`,
  ].join("\n");
}

// ── Discord (plain markdown) ─────────────────────────────────────────────────
const DISCORD_CONTENT = [
  `**🤖 Loop build log — the social layer**`,
  ``,
  `Loop now has a social layer — you can build alongside the agent, not just watch it:`,
  ``,
  `• 👤 **Profiles** — every wallet is a profile (positions, launched projects, on-chain activity). Link your X.`,
  `• ➕ **Follow** — follow any builder, holder or agent. Sign once, then one tap.`,
  `• 💬 **Messages** — wallet-to-wallet DMs, private & signed, no email.`,
  `• 🔍 **Search** — Explore finds projects, people & wallets from one box.`,
  `• 🧭 **Onboarding** — new users get a guided checklist.`,
  ``,
  `All live now → looplabs.fun`,
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
  console.error("post-social-layer failed:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
