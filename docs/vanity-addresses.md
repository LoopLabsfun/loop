# Vanity contract addresses (every CA ends in "Loop")

loop.fun can mint every project's SPL token at an address **ending in a chosen
suffix** (e.g. `…Loop`), the way pump.fun tokens end in `pump` and Bonk's in
`bonk`. This doc covers how it works, the guarantee, and — importantly — how it
scales.

## Must be "Loop", not "loop"

Solana addresses are base58, whose alphabet **excludes `0 O I l`**. A lowercase
`l` can never appear, so an address can never end in `loop`. The valid suffix is
**`Loop`** (capital L).

## How it works (code)

- `lib/vanity.ts` — `nextVanityKeypair(suffix, cluster)` picks the first pool
  keypair whose pubkey ends in `MINT_VANITY_SUFFIX` **and whose mint account
  doesn't exist on-chain yet** (i.e. unused). The chain itself tracks
  consumption, so it's idempotent and needs no extra "used" store for the
  env-pool tier.
- `lib/mint-spl.ts` passes that keypair to `createMint`. **Fail-closed:** when
  the suffix is configured and no unused matching key is available, the launch
  **throws** — it never mints a non-matching address. So the guarantee is hard:
  every published CA ends in `Loop`, or the launch is refused.
- Config: `MINT_VANITY_SUFFIX=Loop` + `VANITY_POOL=<json>` (a JSON array of
  64-byte secret-key arrays). Unset suffix ⇒ random addresses (default).

## The cost (why CPU does not scale)

A 4-char base58 suffix is rare. Measured on an 8-core laptop:

- Grind rate: **~250k keypairs/sec**.
- A `Loop` match empirically took **~100–200M tries ≈ 10–15 min of full CPU per
  key** (the textbook 1-in-58⁴ ≈ 11M underestimates the real trailing-char
  distribution here by ~10–20×).

So **CPU grinding cannot scale**: 100k projects ≈ 100k × ~12 min ≈ **months** of
CPU. Fine for a few dozen launches (grind overnight); hopeless at scale.

## Scaling: GPU pool + replenisher

Vanity grinding is embarrassingly parallel; a GPU runs **100M–1B keys/sec
(~400–4000× a CPU core)**. The industry pattern (pump.fun, Bonk) is to
**pre-grind a large pool on GPU and consume one keypair per launch**, never
grinding at launch time.

```
[GPU grinder]  →  [pool store]  →  [server consumes 1 unused key / launch]
 batch + cron        env or DB        lib/vanity.ts (done) — fail-closed
       ↑________________ replenish when the pool drops below a threshold _______|
```

Tiers:

| Scale | Pool store | Source |
|---|---|---|
| Demo / beta (tens of launches) | `VANITY_POOL` env (current) | CPU grind overnight |
| Production (100k+) | DB table (`vanity_keypairs`, unused/used) consumed atomically | GPU grind, batched + replenisher worker |

The `VANITY_POOL` env tier caps out at a few hundred keys (env size); a DB-backed
pool removes that ceiling and supports a replenisher. Moving to the DB tier is a
schema change to the production database and should be done deliberately.

## Operating the pool

Grind a pool (CPU, overnight) and load it:

```bash
# 1) grind N keypairs ending in Loop (each ~10–15 min of CPU here)
cd scripts/.vanity-pool
solana-keygen grind --ends-with Loop:10 --no-bip39-passphrase

# 2) assemble the env value
node scripts/build-vanity-pool.cjs            # prints VANITY_POOL=[...]

# 3) set in env / Vercel, with the suffix
#    MINT_VANITY_SUFFIX=Loop   VANITY_POOL=[...]
```

The pool dir is gitignored — these are secret keys (inert once used as a mint,
but kept out of git regardless). **Replenish before it empties**: with
fail-closed, an empty pool blocks launches.

## Cheaper alternatives (if "Loop" is too costly)

- A **3-char** suffix is ~58× cheaper to grind.
- Run `Loop` as **best-effort** (drop fail-closed) so launches still succeed with
  a random address when the pool is dry — at the cost of the guarantee.
