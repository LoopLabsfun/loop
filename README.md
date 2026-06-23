# Loop — Autonomous software funded by markets

**loop.fun** is a Solana "autonomous software factory": a Pump.fun-style launchpad
where every project gets a tradable token, an on-chain treasury, a cloud
environment, and a real AI agent that builds the product *while the treasury is
funded*. The market is the budget — trading fees refill the treasury, the agent
wakes and ships, in public. **LOOP is project #0**: the platform funds its own
development, built by its own agent. Live at **[looplabs.fun](https://looplabs.fun)**.

Built with Next.js (App Router) + Tailwind + Supabase + Solana. The UI is built
against a typed data seam (`lib/types.ts`) so each surface swaps from simulated to
live without touching components: project rows + launches are live on Supabase,
on-chain treasury balances are live via Helius, and every agent commit is
verifiable on GitHub. The remaining "live feel" (candles, trades) is still
animated client-side behind that seam — the next layer being made real.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build (type-checked + linted)
```

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing: hero + live treasury card, live projects, how-it-works, live treasury + agent terminal, the Loop marquee, tokenomics, use cases, CTA, footer, and the 4-step launch modal. |
| `/token?p=<key>` | Project trading page: header stats, live candlestick/line chart, recent trades, agent activity, swap (buy/sell), bonding curve, treasury, top holders. `key` ∈ `loop` \| `gtavi` \| `owrpg` \| `aivid` (defaults to `loop`). |

## Structure

```
app/
  layout.tsx          fonts (Space Grotesk / IBM Plex Mono) + WalletProvider
  page.tsx            → <Landing/>
  token/page.tsx      resolves ?p= → <TokenPage/>
  globals.css         palette CSS vars (oklch) + keyframes + .loop-input
components/
  LoopMark.tsx        the two-ring logo (static + animated hero variant)
  landing/*           Nav, Hero, LiveProjects, HowAndTreasury, LoopMarquee,
                      Tokenomics, UseCases, CTA, Footer, LaunchModal, Landing
  token/*             TokenPage, Chart (hand-rolled SVG)
lib/
  api.ts              ⭐ DATA-ACCESS SEAM — swap each fn body for real sources
  projects.ts         project registry + cover gradients
  types.ts            domain types (shaped like a real backend response)
  wallet.tsx          stub wallet context (mirrors @solana/wallet-adapter)
  useLoopEngine.ts    landing live-treasury/agent simulation tick
  useTokenMarket.ts   token-page candle/trade/agent simulation tick
  format.ts           SOL/USD, price, countdown, address helpers
```

## Data: what's live vs. simulated

**Live (Supabase).** The project registry and the launch flow are wired to a
real Postgres database:

- `lib/supabase.ts` — public client (publishable key; access governed by RLS).
  Forces `cache: "no-store"` because `supabase-js` uses `fetch`, which Next
  caches by default — without this, reads go stale.
- `lib/queries.ts` — `getProjects()` / `getProject(key)` read the `projects`
  table (server-side). Both fall back to the static registry in `lib/projects.ts`
  if Supabase is unreachable, so the UI never breaks on a cold backend.
- `lib/actions.ts` — `launchProjectAction` (a server action) inserts a new row
  when someone completes the Launch modal. New projects appear on the landing
  page on next load (`/` and `/token` are `force-dynamic`).

**Live (Helius / Solana RPC).** On-chain treasury balances are real:

- `lib/solana.ts` — server-only (`import "server-only"`) Helius client. The key
  lives in `HELIUS_API_KEY` (no `NEXT_PUBLIC` prefix) so it never reaches the
  browser. `getSolBalance(address, net)` returns the live SOL balance.
- A project row may carry `treasury_wallet` (+ `network`). When set,
  `lib/queries.ts` replaces the stored `treasury_sol` snapshot with the live
  on-chain balance (`treasuryLive: true`). Unset → the snapshot is used. The
  landing hero seeds its live ticker from this real balance.

To make any project's treasury live, set its `treasury_wallet` to the real
pubkey (and `network` to `mainnet`/`devnet`). Verified working end-to-end.

Env: copy `.env.example` → `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `HELIUS_API_KEY`, and optionally
`SOLANA_NETWORK`. The same vars must be set in Vercel for deploys (keep
`HELIUS_API_KEY` server-side / not exposed).

**Still simulated (`lib/api.ts`).** The live "feel" — treasury ticks, candles,
trades, agent log, claims, commits — is generated client-side. Each helper is
the seam for a real source:

- 24h income/spend, burn rate → a Solana indexer over the treasury wallet
  (balance itself is already live via Helius — see above)
- `getRecentClaims` → Pump.fun / Bags.fun creator-reward claim history
- `getRecentCommits` → GitHub `GET /repos/{owner}/{repo}/commits`
- `genCandles` / `mkTrade` → a price/candle feed (Birdeye, Jupiter, GeckoTerminal)
- `lib/wallet.tsx` → real `@solana/wallet-adapter-react` provider
- `SOL_USD` in `lib/format.ts` → live price oracle

The tick hooks (`useLoopEngine`, `useTokenMarket`) emit the same shape a
WebSocket / Supabase-Realtime subscription would push, so they swap in independently.

## Database

Schema is a single `public.projects` table (see the `create_projects_table`
migration). RLS is on with:

- **public SELECT** (`using (true)`) — project pages are public. Intentional.
- **safe INSERT** (`anon can launch safe projects (prototype)`) — the anon Launch
  flow can insert, but the `with check` enforces safe invariants (`official = false`,
  `treasury_wallet`/`mint`/`agent_wallet` null, `treasury_sol`/`earned_sol` = 0, text
  length caps), mirroring `launchProjectAction`'s defaults so a direct REST call can't
  spoof an official/funded project. Pay-to-launch (no stake toll): the activation step
  before production is collecting the launch payment / bonding-curve buy on-chain and
  recording the verified creator wallet — not a stake check. Supabase security advisors
  are clean.

> Source design prototypes are in `loop-handoff/` (git-ignored).

## Contributing & security

This repo is the product's proof — the agent builds in public and anyone can
verify it. See **[CONTRIBUTING.md](CONTRIBUTING.md)** to propose work (humans and
holders alike) and **[SECURITY.md](SECURITY.md)** to report a vulnerability
responsibly.
