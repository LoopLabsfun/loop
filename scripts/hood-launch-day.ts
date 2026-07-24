// ─────────────────────────────────────────────────────────────────────────────
// HOOD LAUNCH DAY — the one-command orchestrator. Runs every step of the $LOOP
// launch on Pons in order, with per-step logs, and RESUMES where it left off
// (state file) so a failure at step 5 never re-launches the token at step 2.
//
//   1. PREFLIGHT   balances, Pons open, live fee, socials configured
//   2. LAUNCH      cast send from the founder's `treasury` keystore account
//                  (interactive password prompt — the key never touches this
//                  process). --tx <hash> skips this if already launched.
//   3. VERIFY      token + pool re-derived from the chain (never trusted)
//   4. SITE        project_chains(loop,hood) row + NEXT_PUBLIC_HOOD_LOOP_MINT + deploy
//   5. PAUSE       founder does the REAL test swap on the page (Enter to go on)
//   6. X THREAD    image + quote-tweet + replies; tweet 1 URL captured
//   7. TELEGRAM    channel announce INCLUDING the tweet URL (founder pins)
//   8. DISCORD     #announcements INCLUDING the tweet URL
//
// All CONTENT (launch params, thread, announce templates) comes from a private
// config outside the repo — no marketing copy is committed here (founder rule).
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/hood-launch-day.ts \
//     ~/Desktop/dev/loop-private-notes/hood-launch-day.config.json [--tx 0x…]
// ─────────────────────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import readline from "readline";
import { spawnSync } from "child_process";
import { createClient } from "@supabase/supabase-js";
import {
  encodeLaunchToken,
  launchValueWei,
  PONS_FACTORY,
  type PonsTokenParams,
} from "../lib/chains/pons";
import { readLaunchFeeWei, readLaunchEnabled, verifyPonsLaunchTx } from "../lib/chains/pons-launch";
import { sendTweet, uploadTweetMedia, isXConfigured } from "../lib/x-send";
import { sendTelegramMessage, isTelegramConfigured } from "../lib/telegram-send";
import { isDiscordBotConfigured, findChannelId, postToChannel } from "../lib/discord-bot";

interface Config {
  /**
   * Pons launch params. `feeWallet` is REQUIRED here, not optional as in
   * PonsTokenParams: leaving it out makes Pons fall back to msg.sender, so the
   * destination of every future trading fee would depend on which wallet
   * happened to sign. Decision A: it is the creator/treasury wallet.
   */
  token: PonsTokenParams & { feeWallet: string };
  devBuyEth: number;
  salt: string;
  /** cast keystore account name holding the treasury key. */
  castAccount: string;
  /** Provisioned Hood agent EVM wallet (Privy), written into project_chains. */
  agentWallet?: string | null;
  treasury: string;
  /** Thread spec (same format as scripts/post-thread.ts). */
  threadSpecPath: string;
  /** Announce templates — {tweetUrl} {token} placeholders. */
  telegramHtml: string;
  discordText: string;
}
interface ThreadEntry { text: string; imagePath?: string; quoteTweetId?: string }
interface State {
  txHash?: string;
  token?: string;
  pool?: string;
  siteDone?: boolean;
  tweetUrl?: string;
  telegramDone?: boolean;
  discordDone?: boolean;
}

const RPC = process.env.HOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const configPath = process.argv[2];
const txFlag = (() => { const i = process.argv.indexOf("--tx"); return i > 0 ? process.argv[i + 1] : undefined; })();

const step = (n: number, label: string) => console.log(`\n━━━ ${n}. ${label} ━━━`);
const ok = (m: string) => console.log(`  ✅ ${m}`);
const info = (m: string) => console.log(`  · ${m}`);
const warn = (m: string) => console.log(`  ⚠️  ${m}`);
const die: (m: string) => never = (m) => { console.error(`  ❌ ${m}`); process.exit(1); };

async function rpcCall(method: string, params: unknown[]): Promise<string> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return ((await r.json()) as { result?: string }).result ?? "0x0";
}

function pause(msg: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(`\n⏸  ${msg}\n   [Entrée pour continuer] `, () => { rl.close(); res(); }));
}

(async () => {
  if (!configPath || configPath.startsWith("--")) die("usage: hood-launch-day.ts <config.json> [--tx 0x…]");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8")) as Config;
  const statePath = path.join(path.dirname(configPath), "hood-launch-day-state.json");
  const state: State = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  if (txFlag) state.txHash = txFlag;

  // ── 1. PREFLIGHT ────────────────────────────────────────────────────────
  step(1, "PREFLIGHT");
  const enabled = await readLaunchEnabled();
  if (enabled !== true) die(`Pons launchEnabled = ${enabled} — lancements fermés.`);
  ok("Pons: lancements ouverts");
  const feeWei = await readLaunchFeeWei();
  if (feeWei == null) die("impossible de lire launchFee()");
  if (!/^0x[0-9a-fA-F]{40}$/.test(cfg.token.feeWallet || "")) {
    die("config.token.feeWallet manquant/invalide — c'est lui qui reçoit le dev-buy ET toutes les fees futures. STOP.");
  }
  const devBuyWei = BigInt(Math.round(cfg.devBuyEth * 1e18));
  const valueWei = launchValueWei(feeWei, devBuyWei);
  ok(`launchFee live: ${Number(feeWei) / 1e18} ETH · dev-buy: ${cfg.devBuyEth} ETH · value totale: ${Number(valueWei) / 1e18} ETH`);
  info(`X: ${isXConfigured() ? "✓" : "✗ NON CONFIGURÉ"} · Telegram: ${isTelegramConfigured() ? "✓" : "✗"} · Discord bot: ${isDiscordBotConfigured() ? "✓" : "✗"}`);
  if (!isXConfigured() || !isTelegramConfigured() || !isDiscordBotConfigured()) die("configure les réseaux avant le jour J.");
  const thread = JSON.parse(fs.readFileSync(cfg.threadSpecPath, "utf8")) as ThreadEntry[];
  for (const [i, e] of thread.map((e, i) => [i, e] as const)) {
    if (e.text.length > 280) die(`tweet ${i + 1}: ${e.text.length} chars (> 280)`);
    if (e.imagePath && !fs.existsSync(e.imagePath)) die(`tweet ${i + 1}: image introuvable ${e.imagePath}`);
  }
  ok(`thread: ${thread.length} tweets valides`);
  if (!state.txHash) {
    const bal = BigInt(await rpcCall("eth_getBalance", [cfg.treasury, "latest"]));
    const gasMargin = BigInt(Math.round(0.001 * 1e18));
    if (bal < valueWei + gasMargin) {
      die(`trésor ${cfg.treasury}: ${Number(bal) / 1e18} ETH — il faut ≥ ${Number(valueWei + gasMargin) / 1e18} (value + ~0.001 gas)`);
    }
    ok(`trésor financé: ${Number(bal) / 1e18} ETH`);
  } else info("launch déjà fait (--tx/state) — solde non vérifié");

  // ── 2. LAUNCH ───────────────────────────────────────────────────────────
  step(2, "LAUNCH sur Pons");
  if (state.txHash) { info(`déjà lancé: ${state.txHash}`); }
  else {
    const data = encodeLaunchToken(cfg.token, { salt: cfg.salt });
    info(`cast send depuis le compte "${cfg.castAccount}" — tape ton mot de passe keystore ci-dessous`);
    const r = spawnSync(
      "cast",
      ["send", PONS_FACTORY, data, "--value", valueWei.toString(), "--account", cfg.castAccount, "--rpc-url", RPC, "--json"],
      { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" }
    );
    const out = r.stdout ?? "";
    const m = out.match(/"transactionHash"\s*:\s*"(0x[0-9a-fA-F]{64})"/) ?? out.match(/(0x[0-9a-fA-F]{64})/);
    if (r.status !== 0 || !m) die(`cast send a échoué (exit ${r.status}).\n${out.slice(-400)}`);
    state.txHash = m[1]; save();
    ok(`tx envoyée: ${state.txHash}`);
  }

  // ── 3. VERIFY ───────────────────────────────────────────────────────────
  step(3, "VÉRIFICATION on-chain");
  if (!state.token) {
    const v = await verifyPonsLaunchTx(state.txHash!);
    if (!v) die("vérification échouée — tx introuvable/revert/pas vers la factory Pons.");
    // What actually decides where the dev buy and every future trading fee go is
    // the launch's feeWallet — NOT who signed. Checking the deployer conflated
    // the two roles and would have passed a launch whose fees were redirected
    // somewhere else entirely. Compare the thing that is irreversible.
    const fw = cfg.token.feeWallet.toLowerCase();
    if (v.feeWallet && v.feeWallet.toLowerCase() !== fw) {
      die(`feeWallet on-chain ${v.feeWallet} ≠ ${cfg.token.feeWallet} — les fees N'IRAIENT PAS au trésor. STOP.`);
    }
    if (v.from !== fw) {
      warn(`déployeur ${v.from} ≠ feeWallet ${cfg.token.feeWallet} — normal si tu as signé depuis un autre wallet; le dev-buy et les fees vont au feeWallet.`);
    }
    state.token = v.token; state.pool = v.pool ?? undefined; save();
  }
  ok(`token $LOOP (Hood): ${state.token}`);
  ok(`pool: ${state.pool ?? "(à retrouver plus tard)"} · feeWallet = ${cfg.token.feeWallet} ✓`);

  // ── 4. SITE ─────────────────────────────────────────────────────────────
  step(4, "SITE (DB + env + deploy)");
  if (state.siteDone) info("déjà fait");
  else {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    // ONE project, N chains: the Hood launch is a DEPLOYMENT of `loop`, recorded
    // in project_chains — never a second `loop-hood` project row. That older
    // shape meant two agents ticking on the same repo and duplicated Claude
    // spend, which is exactly what the multichain refactor removed.
    const { data: existing } = await sb
      .from("project_chains").select("mint")
      .eq("project_key", "loop").eq("chain", "hood").maybeSingle();
    const prevMint = (existing as { mint?: string } | null)?.mint;
    if (prevMint && prevMint.toLowerCase() !== state.token!.toLowerCase()) {
      die(`le déploiement hood de loop existe avec un AUTRE mint (${prevMint}) — résous à la main.`);
    }
    if (!prevMint) {
      const { error: e2 } = await sb.from("project_chains").upsert(
        {
          project_key: "loop",
          chain: "hood",
          mint: state.token,
          // Decision A: the Hood treasury IS the creator wallet, mirroring
          // Solana where treasury == creator. It is also the launch feeWallet,
          // so trading fees land where the agent's runway is counted.
          treasury_wallet: cfg.token.feeWallet,
          agent_wallet: cfg.agentWallet ?? null,
          launchpad: "Pons",
          network: "mainnet",
          launched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_key,chain" }
      );
      if (e2) die(`upsert project_chains(loop,hood): ${e2.message}`);
      ok("déploiement hood enregistré dans project_chains (Pons) — /token?p=loop&chain=hood");
    } else info("déploiement hood déjà enregistré avec ce mint");
    spawnSync("vercel", ["env", "rm", "NEXT_PUBLIC_HOOD_LOOP_MINT", "production", "--yes"], { stdio: "ignore" });
    const add = spawnSync("vercel", ["env", "add", "NEXT_PUBLIC_HOOD_LOOP_MINT", "production"], { input: state.token!, encoding: "utf8" });
    if (add.status !== 0) die(`vercel env add: ${add.stderr?.slice(-300)}`);
    ok("NEXT_PUBLIC_HOOD_LOOP_MINT posée");
    info("déploiement prod (2-3 min)…");
    const dep = spawnSync("vercel", ["--prod", "--yes"], { encoding: "utf8" });
    if (dep.status !== 0) die(`vercel --prod: ${(dep.stderr || dep.stdout)?.slice(-300)}`);
    ok("prod déployée — /token?p=loop&chain=hood affiche le vrai marché Pons");
    state.siteDone = true; save();
  }

  // ── 5. PAUSE — test swap réel ───────────────────────────────────────────
  if (!state.tweetUrl) {
    await pause("Fais ton SWAP DE TEST réel sur looplabs.fun (page loop-hood) MAINTENANT — le thread dit « live », il faut que ce soit vrai.");
  }

  // ── 6. X THREAD ─────────────────────────────────────────────────────────
  step(6, "THREAD X");
  if (state.tweetUrl) info(`déjà posté: ${state.tweetUrl}`);
  else {
    let prevId: string | undefined; let firstId: string | undefined;
    for (let i = 0; i < thread.length; i++) {
      const e = thread[i];
      let mediaIds: string[] | undefined;
      if (e.imagePath) {
        const up = await uploadTweetMedia(new Uint8Array(fs.readFileSync(e.imagePath)),
          /\.png$/i.test(e.imagePath) ? "image/png" : "image/jpeg");
        if (!up.ok) die(`upload image (tweet ${i + 1}): ${up.error}`);
        mediaIds = [up.mediaId!];
      }
      const r = await sendTweet(e.text, prevId, { quoteTweetId: e.quoteTweetId, mediaIds });
      if (!r.ok) die(`tweet ${i + 1}: ${r.error} — ${i} posté(s); relance pour reprendre ici après correction.`);
      ok(`tweet ${i + 1}/${thread.length} → https://x.com/i/web/status/${r.id}`);
      prevId = r.id; if (!firstId) firstId = r.id;
    }
    state.tweetUrl = `https://x.com/Looplabsfun/status/${firstId}`; save();
  }
  ok(`tweet d'annonce: ${state.tweetUrl}`);

  const fill = (t: string) => t.replaceAll("{tweetUrl}", state.tweetUrl!).replaceAll("{token}", state.token!);

  // ── 7. TELEGRAM ─────────────────────────────────────────────────────────
  step(7, "TELEGRAM (channel)");
  if (state.telegramDone) info("déjà posté");
  else {
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (!chat) die("TELEGRAM_CHAT_ID manquant");
    const r = await sendTelegramMessage(chat, fill(cfg.telegramHtml), undefined, "HTML");
    if (!r.ok) die(`telegram: ${r.error}`);
    state.telegramDone = true; save();
    ok("posté sur le channel — ÉPINGLE-LE (le bot n'a pas le droit de pin)");
  }

  // ── 8. DISCORD ──────────────────────────────────────────────────────────
  step(8, "DISCORD (#announcements)");
  if (state.discordDone) info("déjà posté");
  else {
    const ch = await findChannelId("announcements");
    if (!ch) die("channel #announcements introuvable");
    const r = await postToChannel(ch, { content: fill(cfg.discordText), allowed_mentions: { parse: [] } });
    if (!r.ok) die(`discord: ${r.error}`);
    state.discordDone = true; save();
    ok("posté dans #announcements");
  }

  console.log(`\n🎉 LANCEMENT COMPLET
  token   ${state.token}
  tx      ${state.txHash}
  tweet   ${state.tweetUrl}
  À toi : épingler le message Telegram · vérifier Axiom d'ici quelques minutes.
  Ensuite (moi) : bio X dual-chain, buybot Hood, bouton Collect fees, ledger 30/65/5 Hood.\n`);
})().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
