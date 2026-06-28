-- Pre-launch funding: the project's Loop-custodial wallet (provisioned at whitelist,
-- becomes the on-chain creator/treasury at mint) + the refundable "vote with SOL"
-- ledger. Idempotent — safe to replay.

-- 1) project wallet on the draft row
alter table public.launch_waitlist add column if not exists project_wallet text;
alter table public.launch_waitlist add column if not exists project_wallet_id text;

-- 2) the pre-funding ledger (per-sender, dedup by tx_sig → refundable)
create table if not exists public.prelaunch_contributions (
  id bigint generated always as identity primary key,
  draft_wallet text not null,
  project_wallet text not null,
  contributor_wallet text not null,
  amount_sol numeric not null check (amount_sol > 0),
  tx_sig text not null unique,
  status text not null default 'confirmed', -- confirmed | refunded
  created_at timestamptz not null default now()
);
alter table public.prelaunch_contributions enable row level security; -- service-role only
create index if not exists prelaunch_contributions_draft_idx
  on public.prelaunch_contributions (draft_wallet);
