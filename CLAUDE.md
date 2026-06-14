# CLAUDE.md

Guidance for working in this repo.

## What this is

**loop.fun** — a Solana "autonomous software factory": a Pump.fun-style launchpad where
each project gets a token, an on-chain treasury, a cloud env, and an AI agent that builds
it while the treasury is funded. The first project is LOOP itself (the platform funds its
own development). See the [README](README.md) for the product pitch.

## Stack

- **Next.js 14 (App Router) + React 18**, TypeScript.
- **Tailwind CSS 3** — design tokens defined as CSS variables in [app/globals.css](app/globals.css)
  and surfaced as Tailwind colors in [tailwind.config.ts](tailwind.config.ts). Light/violet theme,
  oklch accent (`0.47 0.21 285`), fonts Space Grotesk (display) + IBM Plex Mono.
- **Supabase** (`@supabase/supabase-js`) — Postgres backing the `projects` table.
- **Solana** (`@solana/web3.js` + Helius RPC) — live on-chain SOL balances.
- `@solana/wallet-adapter-*` is a dependency, but wallet connect is currently a **stub**
  context in [lib/wallet.tsx](lib/wallet.tsx) mirroring the adapter's shape.

## Commands

```bash
npm run dev      # next dev on :3000
npm run build    # production build (run before pushing — catches type/route errors)
npm run start    # serve the production build
npm run lint     # next lint
npx tsc --noEmit # typecheck only
```

## Routes

- `/` — landing page ([app/page.tsx](app/page.tsx) → [components/landing/Landing.tsx](components/landing/Landing.tsx)).
- `/token?p=<key>` — per-project trading page ([app/token/page.tsx](app/token/page.tsx) → [components/token/TokenPage.tsx](components/token/TokenPage.tsx)).

Both are `export const dynamic = "force-dynamic"` so newly launched projects appear without
a redeploy and on-chain reads aren't statically cached.

## Architecture — the data seam

The important design idea: **the UI is built against a typed seam so simulated data can be
swapped for live data without touching components.** All domain types live in
[lib/types.ts](lib/types.ts). There are three data sources behind that seam:

1. **Live — Supabase** ([lib/queries.ts](lib/queries.ts), [lib/actions.ts](lib/actions.ts)).
   `getProjects()` / `getProject(key)` read the `projects` table; both **fall back to the
   static registry** in [lib/projects.ts](lib/projects.ts) if Supabase is unconfigured or the
   request fails — the UI never breaks on a cold backend. `launchProjectAction` is a
   `"use server"` server action that inserts a real row (the Launch modal).

2. **Live — Helius / Solana** ([lib/solana.ts](lib/solana.ts)). Server-only. When a project row
   has a `treasury_wallet`, `withLiveBalances()` in queries.ts overrides the stored
   `treasury_sol` snapshot with the real on-chain balance and sets `treasuryLive: true`.

3. **Simulated** ([lib/api.ts](lib/api.ts) + the [lib/useLoopEngine.ts](lib/useLoopEngine.ts) /
   [lib/useTokenMarket.ts](lib/useTokenMarket.ts) hooks). The "live feel" — treasury income/spend,
   candles, trades, agent log, claims, recent commits — is animated client-side. This is the
   next layer to make real.

### The agent seam (Polsia model)

The product's core is a real autonomous agent per project. The UI is built
against two pure, testable seam modules so the simulation can be swapped for a
live runtime without touching components:

- [lib/console.ts](lib/console.ts) → [components/token/AgentConsole.tsx](components/token/AgentConsole.tsx) —
  **steering**: the founder directs the agent, holders propose/vote, the agent
  escalates out-of-mandate decisions (the escalation ladder).
- [lib/agent.ts](lib/agent.ts) → [components/token/AgentOperator.tsx](components/token/AgentOperator.tsx) —
  **autonomous work**: tasks, the agent's email inbox (`<slug>@agents.loop.fun`),
  social presence (`@<slug>_agent`), and business stats.

The full build plan for turning this seam into real per-project agents (Claude
Agent SDK + Trigger.dev + E2B sandbox + email/social providers + custody +
mainnet phases, and the founder-only blockers) is in
[docs/agent-runtime.md](docs/agent-runtime.md).

## Supabase

- Project ref `tbxavergltotxehjabkt` (name "LOOP", eu-north-1). MCP configured in [.mcp.json](.mcp.json).
- Client created in [lib/supabase.ts](lib/supabase.ts) with `auth.persistSession: false`.
  **Gotcha:** it forces `cache: "no-store"` on the client's `fetch` because supabase-js uses
  `fetch` and Next caches GETs by default → stale reads otherwise. Don't remove this.
- `rowToProject` in queries.ts maps snake_case columns → camelCase `Project`.
- **RLS (hardened):** there's no auth layer yet, so the `projects` INSERT policy still allows
  anon inserts — but it's no longer `with check (true)`. The policy
  `anon can launch safe projects (prototype)` enforces safe invariants (`official = false`,
  `treasury_wallet`/`mint` null, `treasury_sol`/`earned_sol` = 0, length caps on text fields),
  mirroring `launchProjectAction`'s defaults so direct REST calls can't spoof an official/funded
  project. The unused `rls_auto_enable()` SECURITY DEFINER fn has had `execute` revoked from
  `anon`/`authenticated`. Supabase security advisors are clean. **Still TODO for real launch:**
  verify/lock the 1,000 LOOP stake on-chain (wallet-signature ownership proof) before inserting.

## Solana / Helius (devnet + mainnet)

[lib/solana.ts](lib/solana.ts) is the only place that talks to the chain. Key points:

- `import "server-only"` — importing it from a Client Component fails the build, by design.
- API key in **`HELIUS_API_KEY`** (no `NEXT_PUBLIC_` prefix, never ships to the browser).
- Supports both clusters via `Network = "mainnet" | "devnet"`; endpoint is
  `https://{mainnet|devnet}.helius-rpc.com/?api-key=…`. Connections are cached per network.
- `DEFAULT_NETWORK` comes from `SOLANA_NETWORK` env (`devnet` → devnet, else mainnet).
- `getSolBalance(address, net)` returns SOL (lamports / `LAMPORTS_PER_SOL`) or `null` on
  unconfigured/invalid/failed reads — callers treat `null` as "keep the snapshot".
- A project row's `network` column ("mainnet"/"devnet") selects the cluster per project, so
  mainnet and devnet projects can coexist.

## Environment

Copy [.env.example](.env.example) → `.env.local` (gitignored). Required:

| Var | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | publishable key; RLS enforces access |
| `HELIUS_API_KEY` | **server-only** | no `NEXT_PUBLIC_` prefix |
| `SOLANA_NETWORK` | server | `mainnet` (default) or `devnet` |

These must also be set in Vercel for deploys to function.

## Conventions

- Server Components by default; `"use client"` only where interactivity/hooks are needed
  (the engine hooks, wallet, modals, chart).
- Keep secrets server-side. Anything touching `HELIUS_API_KEY` stays behind `server-only`.
- When adding live data, extend the seam in `lib/queries.ts` / `lib/api.ts` and keep the
  static fallback path working — components should never need a configured backend to render.
- Match the surrounding Tailwind-token style (`text-muted`, `bg-surface`, `border-line-2`,
  `font-display`, `font-mono`) rather than hardcoding colors.
