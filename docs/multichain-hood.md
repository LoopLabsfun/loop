# Multichain: Solana + Hood (Robinhood Chain)

Plan for making Loop dual-chain: every project (and the header, wallet, launch and
trading paths) targets either **Solana** or **Hood** (Robinhood Chain, an EVM
Arbitrum-Orbit L2, chain id **4663**). The official $LOOP token will be relaunched
on Hood via the HoodLauncher contract; Solana keeps working unchanged.

The launchpad contract already exists in the sibling repo `dev/hood`:
`src/launchpad/HoodLauncher.sol` — a bonding-curve launchpad (pump.fun mechanics
in ETH: create+initial-buy, buy/sell on x*y=k virtual reserves, non-transferable
until migration, auto-migration to Uniswap v2 with burned LP, fees accrued in the
contract with `withdrawFees()`). 14 forge tests green. Its demo frontend
(`hood/web`) already has the wagmi/viem chain config and the full launcher ABI —
both get ported here, not rewritten.

## Chain facts (Hood)

| | |
|---|---|
| Chain id | 4663 |
| Native currency | ETH (18 decimals) |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` (Blockscout, Etherscan-compatible API) |
| DEX after migration | Uniswap v2 (router address on 4663 still to confirm — see Blockers) |

## Design: `chain` is a new dimension, not a new `network`

Today `Network = "mainnet" | "devnet"` is a **Solana cluster** switch
([lib/network.tsx](../lib/network.tsx), `projects.network` column). Overloading it
with `"hood"` would conflate two axes. Instead:

- **New type `Chain = "solana" | "hood"`** in a new folder **`lib/chains/`** (the
  chain seam, mirroring how `lib/solana.ts` is the only Solana touchpoint).
- The header gets a **Solana / Hood switch** (`ChainProvider`, localStorage key
  `loop.chain`, same SSR-reconcile pattern as `NetworkProvider`). It drives:
  which wallet stack is active, which projects the landing lists first, and which
  chain the Launch modal targets.
- The existing devnet/mainnet toggle becomes Solana-scoped (hidden when
  chain = hood; Hood is mainnet-only for now).
- `projects` gets a **`chain` column** (`'solana'` default). Address columns
  (`treasury_wallet`, `mint`, `creator_wallet`, …) are reused as-is — base58 on
  Solana, `0x…` on Hood. `treasury_sol` / `earned_sol` are reinterpreted as
  **native units** (SOL or ETH); the UI reads the symbol from the chain registry
  instead of hardcoding "SOL".

### New folder layout

```
lib/chains/
  types.ts        Chain, ChainInfo, address helpers
  registry.ts     per-chain metadata (symbol, decimals, rpc env, explorer links)
  hood.ts         server-only Hood reads — plain fetch JSON-RPC (eth_getBalance,
                  eth_call for ERC-20 balanceOf + HoodLauncher curve state),
                  same dependency-free pattern as lib/solana.ts (avoids the
                  ESM/bundling problems that pushed solana.ts off web3.js)
  hood-abi.ts     HoodLauncher + ERC-20 ABIs (ported from hood/web/lib/config.ts)
  hood-client.tsx wagmi/viem client config + EVM wallet provider (client-only)
```

`lib/solana.ts` stays where it is (too many imports to churn); `lib/chains/`
grows alongside it and `queries.ts` dispatches on `project.chain`.

## Phases

### Phase 0 — Foundation — ✅ SHIPPED
- `lib/chains/` types + registry. ✅
- Supabase migration: `alter table projects add column chain text not null
  default 'solana' check (chain in ('solana','hood'))` — in
  [supabase/schema.sql](../supabase/schema.sql), **not yet applied to prod**
  (the Supabase MCP needs an interactive OAuth). Not blocking: `rowToProject`
  tolerates the missing column and falls back to address-shape inference
  (0x… treasury/mint ⇒ hood). No RLS change needed — the anon-insert policy is
  dropped in prod (Phase A, service-role launches only).
- `Project.chain` in [lib/types.ts](../lib/types.ts) + `rowToProject` mapping. ✅
- `ChainProvider` + header switch (Landing + TokenPage). Hood view renders an
  empty/teaser state until hood rows exist. ✅

### Phase 1 — Read path (Hood projects render) — ⚙️ CORE SHIPPED
- `lib/chains/hood.ts`: `getEthBalance` + `getErc20Balance` (fetch JSON-RPC,
  cached). ✅ Remaining: `getCurveState` (launcher `curves(token)` +
  `quoteBuy`/`quoteSell` via `eth_call`), Trade-event reads via Blockscout API /
  `eth_getLogs` for the trades feed + candles.
- `withLiveBalances()` in [lib/queries.ts](../lib/queries.ts) dispatches:
  solana → Helius, hood → Hood RPC. ✅ (No treasury-history reconstruction on
  hood yet.)
- Explorer links go through `explorerUrl`/`explorerTx` (chain param) →
  Blockscout on hood. ✅ at the project-scoped TokenPage sites; remaining call
  sites get the param as hood rows reach them.
- UI denomination: landing card + launch/trade gates are chain-aware. ✅
  Remaining: the full "SOL"-label sweep inside TokenPage panels (do it when the
  first hood row renders, against real data).
- Env: `HOOD_RPC_URL` (server, optional — public RPC default),
  `NEXT_PUBLIC_DEFAULT_CHAIN`, `NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS` (Phase 3+). ✅

### Phase 2 — Wallet (EVM behind the same façade)
- Add `wagmi` + `viem` (client) — port `hood/web/lib/config.ts`.
- Keep the `useWallet()` façade interface ([lib/wallet.tsx](../lib/wallet.tsx))
  and make it chain-aware: when chain = hood, `connect`/`address`/`getSolBalance`
  (→ native balance)/`sendSol` (→ ETH transfer) route to wagmi; injected
  connector first (MetaMask/Rabby/Robinhood wallet).
- Signed-message proofs (launch/stake/chat/directive/admin/profile/waitlist):
  EVM path uses `personal_sign`; server verification in the signature module
  gets a secp256k1 branch (viem `verifyMessage`) next to the existing ed25519
  one. Message namespaces stay identical.

### Phase 3 — Trading (buy/sell on the curve)
- TokenPage BUY/SELL on hood = direct `buy`/`sell` contract writes with
  `quoteBuy`/`quoteSell` + slippage (simpler than the pump.fun path — no
  PumpPortal, no serialized-tx server hop).
- Market stats pre-migration come from curve state (progress = realEth/target,
  price from virtual reserves, mcap = price × supply); post-migration from
  DexScreener/GeckoTerminal if they index chain 4663 (verify — else keep reading
  the Uniswap pair via RPC).
- ETH/USD price feed added next to the existing SOL/USD one (lib/price.ts).

### Phase 4 — Launch + official $LOOP relaunch
- Deploy HoodLauncher to 4663 (`script/DeployLauncher.s.sol` — blocked on the
  Uniswap v2 router address + the audit noted in the hood README).
- Launch modal chain-aware: on hood it calls `createToken(name, symbol, minOut)`
  payable (creation fee + dev initial buy in one tx — the launch toll is native
  to the contract, so `launch-fee.ts` verification becomes: confirm the
  `TokenCreated` tx on-chain, replay-guard via tx hash in `launch_payment_sig`).
- Relaunch official LOOP: `createToken` from the founder wallet, insert the
  official row (`chain='hood'`, `official=true`, mint = ERC-20 address,
  treasury = EVM treasury). Solana $LOOP row stays live; the token page can
  cross-link the two.
- SOL-payment UX (optional later): Relay/deBridge cross-chain execution so
  Solana users can buy on hood curves paying SOL (contract needs zero changes —
  documented in the hood README).

### Phase 5 — Agent + economics on Hood
- Treasury runway/burn math reads native units + a USD conversion per chain.
- Fees: `withdrawFees()` from the launcher (platform revenue) + per-curve 1%
  trade fee attribution; the 30/65/5 split logic in lib/fees.ts is
  chain-agnostic once amounts are in native units.
- Agent wallet on EVM (custody decision — Privy supports EVM wallets, same
  provider as today).
- Buyback path: Uniswap v2 swap instead of Jupiter.

## Blockers / founder decisions

1. **Uniswap v2 router address on chain 4663** — needed before any deploy
   (hood README flags it; check docs.uniswap.org deployments).
2. **Audit of HoodLauncher** before it holds third-party ETH (hood README).
3. **LOOP relaunch tokenomics** — fresh curve launch vs. snapshot/airdrop to
   Solana holders vs. bridge; supply and what happens to the Solana token.
4. **Announcement timing** — this repo is public; committing this plan and the
   hood scaffolding reveals the relaunch before any announcement.
5. **DexScreener/GeckoTerminal coverage of chain 4663** — determines the
   post-migration market-data source.
