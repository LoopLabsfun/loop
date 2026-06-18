-- ─────────────────────────────────────────────────────────────────────────────
-- Loop — full Supabase schema (all 13 migrations, in order).
--
-- Run this once in a NEW Supabase project: Dashboard → SQL Editor → paste → Run.
-- It recreates every table + RLS policy + function the app needs:
--   projects, vanity_keypairs (+ claim fns), agent_tasks/emails/posts/
--   escalations/actions, directives, learnings, fee_ledger, compute_ledger.
--
-- Reflects current prod state, including Phase A (LOOP-only): the public
-- anon-insert policy is created then dropped at the end, so only the
-- service-role client (the founder's launch script) can create projects.
--
-- DATA is NOT included (migrate rows separately): the LOOP project row, the
-- vanity `…Loop` keypair pool (secrets), learnings, and the ledgers.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── projects ────────────────────────────────────────────────────────────────
create table public.projects (
  key          text primary key,
  name         text not null,
  ticker       text not null,
  description  text not null default '',
  official     boolean not null default false,
  launchpad    text not null default 'Pump.fun',
  repo         text not null default '',
  cover        text not null default 'loop',
  prompt       text not null default '',
  price        double precision not null default 0,
  market_cap   text not null default '$0',
  liquidity    text not null default '$0',
  holders      text not null default '0',
  volume_24h   text not null default '0 SOL',
  curve        double precision not null default 0,
  supply       text not null default '1B',
  treasury_sol double precision not null default 0,
  earned_sol   double precision not null default 0,
  burn_per_day text not null default '0 SOL/day',
  runway       text not null default '—',
  created_at   timestamptz not null default now()
);
comment on table public.projects is 'Projects launched on Loop. One row per project token.';
create index projects_official_created_idx on public.projects (official desc, created_at desc);
alter table public.projects enable row level security;
create policy "projects are publicly readable" on public.projects for select using (true);

-- on-chain columns
alter table public.projects
  add column if not exists treasury_wallet text,
  add column if not exists mint text,
  add column if not exists network text not null default 'mainnet';
comment on column public.projects.treasury_wallet is 'Solana pubkey of the project treasury; null = use treasury_sol snapshot.';
comment on column public.projects.mint is 'SPL token mint address for this project.';
comment on column public.projects.network is 'mainnet | devnet — which cluster to read on-chain state from.';

-- creator wallet (signature proof)
alter table public.projects add column if not exists creator_wallet text;
comment on column public.projects.creator_wallet is 'Base58 pubkey of the wallet that signed the launch proof; null if unproven.';

-- per-project fee economics + steering
alter table public.projects
  add column if not exists fee_founder_pct integer not null default 30,
  add column if not exists agent_wallet text,
  add column if not exists content_policy text,
  add column if not exists guardrails text;
comment on column public.projects.fee_founder_pct is 'Founder share of creator fees (0..95); agent = 95 - this, platform fixed at 5.';
comment on column public.projects.agent_wallet is 'Agent wallet pubkey (provisioned server-side via custody provider); null pre-provision.';
comment on column public.projects.content_policy is 'Founder/DAO content policy steering the agent.';
comment on column public.projects.guardrails is 'Editable guardrails the agent rereads each cycle.';

-- ── vanity_keypairs ──────────────────────────────────────────────────────────
create table if not exists public.vanity_keypairs (
  id bigint generated always as identity primary key,
  pubkey text not null unique,
  secret_key jsonb not null,
  suffix text not null,
  used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.vanity_keypairs enable row level security;
create index if not exists vanity_keypairs_unused_idx on public.vanity_keypairs (suffix) where used = false;

create or replace function public.claim_vanity_keypair(p_suffix text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_secret jsonb;
begin
  select id, secret_key into v_id, v_secret
  from public.vanity_keypairs
  where used = false and suffix = p_suffix
  order by id limit 1 for update skip locked;
  if v_id is null then return null; end if;
  update public.vanity_keypairs set used = true, used_at = now() where id = v_id;
  return v_secret;
end; $$;

create or replace function public.vanity_pool_status()
returns table (suffix text, unused bigint, used bigint)
language sql security definer set search_path = public as $$
  select suffix,
         count(*) filter (where not used) as unused,
         count(*) filter (where used) as used
  from public.vanity_keypairs group by suffix order by suffix;
$$;
revoke all on function public.claim_vanity_keypair(text) from public, anon, authenticated;
revoke all on function public.vanity_pool_status() from public, anon, authenticated;

-- ── agent state tables ───────────────────────────────────────────────────────
create table if not exists public.agent_tasks (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  title text not null,
  detail text not null default '',
  category text not null default 'feature' check (category in ('feature','outreach','fix','ops')),
  status text not null default 'todo' check (status in ('todo','building','shipped','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.agent_tasks is 'Tasks the project agent plans and works. Written by the runtime (service_role); publicly readable.';

create table if not exists public.agent_emails (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  direction text not null check (direction in ('out','in')),
  party text not null,
  subject text not null,
  preview text not null default '',
  created_at timestamptz not null default now()
);
comment on table public.agent_emails is 'Agent email inbox (sent/received). Written by the inbound webhook + send path (service_role); publicly readable.';

create table if not exists public.agent_posts (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  platform text not null default 'telegram' check (platform in ('twitter','reddit','telegram','farcaster')),
  body text not null,
  likes integer not null default 0,
  replies integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.agent_posts is 'Social posts the agent published. Written by the runtime (service_role); publicly readable.';

create table if not exists public.agent_escalations (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  body text not null,
  status text not null default 'open' check (status in ('open','applied','adopted','declined')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
comment on table public.agent_escalations is 'Out-of-mandate decisions the agent escalates. Written by the runtime (service_role); publicly readable.';

create table if not exists public.agent_actions (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
comment on table public.agent_actions is 'Streamed agent action log (console feed). Written by the runtime (service_role); publicly readable.';

create index if not exists agent_tasks_project_idx      on public.agent_tasks      (project_key, created_at desc);
create index if not exists agent_emails_project_idx     on public.agent_emails     (project_key, created_at desc);
create index if not exists agent_posts_project_idx      on public.agent_posts      (project_key, created_at desc);
create index if not exists agent_escalations_project_idx on public.agent_escalations(project_key, created_at desc);
create index if not exists agent_actions_project_idx    on public.agent_actions    (project_key, created_at desc);

alter table public.agent_tasks      enable row level security;
alter table public.agent_emails     enable row level security;
alter table public.agent_posts      enable row level security;
alter table public.agent_escalations enable row level security;
alter table public.agent_actions    enable row level security;

create policy "agent_tasks public read"      on public.agent_tasks      for select to public using (true);
create policy "agent_emails public read"     on public.agent_emails     for select to public using (true);
create policy "agent_posts public read"      on public.agent_posts      for select to public using (true);
create policy "agent_escalations public read" on public.agent_escalations for select to public using (true);
create policy "agent_actions public read"    on public.agent_actions    for select to public using (true);

-- structured agent_actions fields (on-chain positions)
alter table public.agent_actions
  add column if not exists kind text check (kind in ('buyback','burn','airdrop','bounty','swap')),
  add column if not exists amount_sol double precision,
  add column if not exists disposition text check (disposition in ('executed','simulated','escalated','denied')),
  add column if not exists tx_sig text;

-- ── directives ───────────────────────────────────────────────────────────────
create table if not exists public.directives (
  id uuid primary key default gen_random_uuid(),
  project_key text not null references public.projects(key) on delete cascade,
  kind text not null default 'directive' check (kind in ('directive', 'proposal')),
  text text not null check (char_length(text) between 1 and 600),
  author_wallet text check (author_wallet is null or char_length(author_wallet) <= 64),
  role text not null default 'holder' check (role in ('founder', 'holder')),
  status text not null default 'open' check (status in ('open', 'applied', 'adopted', 'declined')),
  for_votes integer not null default 0 check (for_votes >= 0),
  against_votes integer not null default 0 check (against_votes >= 0),
  quorum integer not null default 100 check (quorum > 0),
  created_at timestamptz not null default now()
);
comment on table public.directives is 'Steering directives submitted via the Agent Console. Anon may insert a safe open submission (prototype); the runtime/service_role applies status + tallies. Publicly readable.';
create index if not exists directives_project_created_idx on public.directives (project_key, created_at desc);
alter table public.directives enable row level security;
create policy "directives are publicly readable" on public.directives for select using (true);
create policy "anon can submit a safe directive (prototype)" on public.directives for insert to anon
  with check (
    kind in ('directive', 'proposal')
    and char_length(text) between 1 and 600
    and status = 'open' and role = 'holder'
    and for_votes = 0 and against_votes = 0
    and (author_wallet is null or char_length(author_wallet) <= 64)
  );

-- ── learnings (A5) ───────────────────────────────────────────────────────────
create table if not exists public.learnings (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('outreach','build','growth','gate','ops')),
  insight text not null check (char_length(insight) between 1 and 240),
  source text not null default 'a project',
  upvotes integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.learnings is 'Cross-project anonymized learnings (A5). Service-role write, public read.';
create index if not exists learnings_rank_idx on public.learnings (upvotes desc, created_at desc);
alter table public.learnings enable row level security;
create policy "learnings are publicly readable" on public.learnings for select using (true);

-- ── fee_ledger ───────────────────────────────────────────────────────────────
create table if not exists public.fee_ledger (
  project_key text primary key references public.projects(key) on delete cascade,
  earned_founder_sol double precision not null default 0,
  earned_agent_sol double precision not null default 0,
  earned_platform_sol double precision not null default 0,
  claimed_founder_sol double precision not null default 0,
  claimed_agent_sol double precision not null default 0,
  claimed_platform_sol double precision not null default 0,
  updated_at timestamptz not null default now()
);
comment on table public.fee_ledger is 'Per-project creator-fee accounting: cumulative earned + claimed per role (founder/agent/platform). claimable = earned - claimed. Service-role writes; public reads.';
alter table public.fee_ledger enable row level security;
create policy "fee_ledger public read" on public.fee_ledger for select to anon, authenticated using (true);

-- ── compute_ledger ───────────────────────────────────────────────────────────
create table if not exists public.compute_ledger (
  project_key text primary key,
  credited_usd double precision not null default 0 check (credited_usd >= 0),
  consumed_usd double precision not null default 0 check (consumed_usd >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.compute_ledger is 'Per-project compute funding: cumulative provider credit funded (from converted agent-share SOL) minus consumed. balance = credited_usd - consumed_usd (lib/compute-rail.ts). Service-role writes; public reads.';
alter table public.compute_ledger enable row level security;
create policy "compute_ledger public read" on public.compute_ledger for select to anon, authenticated using (true);

-- ── Phase A: LOOP-only (close public project creation) ───────────────────────
-- No anon insert policy on projects → only the service-role launch script can
-- create a project. Reopen with a hardened insert policy for the public phase.
-- (Intentionally no "anon can launch" policy is created above.)
