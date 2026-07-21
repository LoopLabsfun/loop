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

-- multichain: which chain the project's token/treasury live on (docs/multichain-hood.md).
-- Address columns are reused as-is (base58 on solana, 0x… on hood); treasury_sol /
-- earned_sol hold NATIVE units (SOL or ETH). `network` only applies to solana rows.
alter table public.projects
  add column if not exists chain text not null default 'solana'
    check (chain in ('solana', 'hood'));
comment on column public.projects.chain is 'solana | hood — which chain the token/treasury live on. hood = Robinhood Chain (EVM, id 4663).';

-- creator wallet (signature proof)
alter table public.projects add column if not exists creator_wallet text;
comment on column public.projects.creator_wallet is 'Base58 pubkey of the wallet that signed the launch proof; null if unproven. Also the destination of the founder fee share.';

alter table public.projects add column if not exists fee_creator_wallet text;
comment on column public.projects.fee_creator_wallet is 'On-chain pump.fun creator — the wallet creator fees accrue to / are claimed FROM (distinct from creator_wallet, the founder payout). Several projects can share one (shared launch signer); the claimed lump is attributed across them off-chain (lib/fee-attribution.ts).';

-- pay-to-launch: the on-chain SOL launch-fee payment signature (creator → platform
-- wallet), verified server-side before insert. Null when untolled. The partial
-- unique index is the REPLAY GUARD — one payment can fund at most one launch.
alter table public.projects add column if not exists launch_payment_sig text;
comment on column public.projects.launch_payment_sig is 'Signature of the verified on-chain SOL launch-fee payment; null when pay-to-launch is disabled.';
create unique index if not exists projects_launch_payment_sig_key
  on public.projects (launch_payment_sig) where launch_payment_sig is not null;

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

-- founder admin kill switch: the cron no-ops this project's brain when true
-- (a DB-backed, runtime-mutable counterpart to the global AGENT_PAUSED env).
alter table public.projects add column if not exists agent_paused boolean not null default false;
comment on column public.projects.agent_paused is 'Founder kill switch (admin console): when true the cron skips this project''s brain — no Claude spend, no redeploy needed.';

-- per-project social links + brand images, editable from the platform-admin console
-- (lib/admin-projects.ts). Stored as canonical https URLs (twitter/telegram/discord/
-- website) and public bucket URLs (token_image_url/banner_url, in waitlist-media under
-- projects/<key>/…). These drive the Loop token page; on-chain pump.fun metadata is
-- frozen at mint, so editing here never rewrites an already-minted token's page.
alter table public.projects
  add column if not exists twitter text,
  add column if not exists telegram text,
  add column if not exists discord text,
  add column if not exists website text,
  add column if not exists token_image_url text,
  add column if not exists banner_url text,
  add column if not exists domain text;
comment on column public.projects.twitter is 'Canonical https://x.com/<handle> for the project, or null.';
comment on column public.projects.domain is 'External custom domain attached to the project''s Vercel project (verified), or null → default <slug>.vercel.app. Managed via /api/admin/projects/domain (lib/project-domain.ts).';
comment on column public.projects.telegram is 'Canonical https://t.me/<name> for the project, or null.';
comment on column public.projects.discord is 'Canonical https://discord.gg/<code> invite for the project, or null.';
comment on column public.projects.website is 'Project website (canonical https URL), or null → falls back to the Loop token page.';
comment on column public.projects.token_image_url is 'Public URL of the token logo (waitlist-media bucket); null → mascot/placeholder.';
comment on column public.projects.banner_url is 'Public URL of the project banner (waitlist-media bucket); null → gradient cover.';

-- ── profiles ─────────────────────────────────────────────────────────────────
-- One row per user wallet. The wallet IS the identity on Loop (everything is
-- wallet-signature gated); a profile enriches it with a display name, avatar, bio,
-- and a linked + verified social. Writes are server-side only (service role) after
-- a `loop.fun profile` signature check at /api/profile — same posture as launch,
-- so there is no anon write policy. Public read so any profile page can render.
create table if not exists public.profiles (
  wallet text primary key,
  username text,                  -- unique @handle (lowercase a-z0-9_, 3-20); null until set
  display_name text,
  bio text,
  avatar_url text,
  twitter_handle text,
  twitter_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_uniq on public.profiles (lower(username));
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,20}$') not valid;
comment on table public.profiles is 'User profiles on Loop, keyed by wallet pubkey. Writes go through the service role after a signed loop.fun profile proof; anon can only read.';
alter table public.profiles enable row level security;
create policy "profiles are publicly readable" on public.profiles for select using (true);

-- ── launch_waitlist ──────────────────────────────────────────────────────────
-- Pre-launch project DRAFTS (the standing "when can I launch my own project?"
-- demand) while public launches are closed. Now mirrors the launch form: a wallet
-- signs the submit (creating an account), then drafts its project — name, ticker,
-- build prompt, repo, fee split, banner + token image (stored in the waitlist-media
-- bucket). email/X/idea stay as optional extra contact + product signal. One draft
-- per wallet (re-submitting refines it). Service-role write via /api/waitlist; RLS
-- on with NO policies → never publicly readable (protects contact details).
create table if not exists public.launch_waitlist (
  id bigint generated always as identity primary key,
  wallet text,
  email text,
  x_handle text,
  idea text,
  referrer text,
  -- pre-launch draft (added 2026-06-28)
  name text,
  ticker text,
  banner_url text,
  token_image_url text,
  fee_founder_pct int,
  prompt text,
  repo text,
  -- approval lifecycle: draft → whitelisted → launched (or rejected). project_key
  -- links a launched draft to its public.projects row.
  status text not null default 'draft',
  project_key text,
  -- project_wallet: the Loop-custodial Privy wallet provisioned at WHITELIST; it
  -- becomes the on-chain creator/treasury at mint and receives pre-funding meanwhile.
  project_wallet text,
  project_wallet_id text,
  -- entry-gate payment sigs (the toll to submit: SOL fee + 1M $LOOP). Replay-guarded
  -- by the unique indexes below so a payment can't be reused across requests.
  gate_fee_sig text,
  gate_loop_sig text,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);
-- Idempotent column adds so replaying over a pre-2026-06-28 table upgrades it.
alter table public.launch_waitlist add column if not exists name text;
alter table public.launch_waitlist add column if not exists ticker text;
alter table public.launch_waitlist add column if not exists banner_url text;
alter table public.launch_waitlist add column if not exists token_image_url text;
alter table public.launch_waitlist add column if not exists fee_founder_pct int;
alter table public.launch_waitlist add column if not exists prompt text;
alter table public.launch_waitlist add column if not exists repo text;
alter table public.launch_waitlist add column if not exists status text not null default 'draft';
alter table public.launch_waitlist add column if not exists project_key text;
alter table public.launch_waitlist add column if not exists project_wallet text;
alter table public.launch_waitlist add column if not exists project_wallet_id text;
alter table public.launch_waitlist add column if not exists gate_fee_sig text;
alter table public.launch_waitlist add column if not exists gate_loop_sig text;
alter table public.launch_waitlist add column if not exists updated_at timestamptz;
-- multichain (docs/multichain-hood.md): the chain the draft will LAUNCH on. The
-- proposer's identity/signing wallet stays a Solana pubkey either way.
alter table public.launch_waitlist add column if not exists chain text not null default 'solana'
  check (chain in ('solana', 'hood'));
comment on column public.launch_waitlist.chain is 'solana | hood — target chain for the eventual token. hood drafts skip SOL wallet provisioning and cannot launch until the Hood launcher is live.';
-- Active-only uniqueness (2026-06-30): a wallet may hold at most one ACTIVE
-- (draft/whitelisted) row at a time, but past terminal rows (launched/rejected)
-- never block a later, distinct pitch — a wallet that already launched one
-- project can still submit a second. A blanket per-wallet-forever unique index
-- previously meant a wallet could pass through pre-launch exactly once, ever;
-- combined with joinWaitlist's update-by-wallet path, a launched founder
-- resubmitting a new idea silently overwrote their already-launched row's
-- content (name/ticker/prompt) while status/project_key stayed stale.
drop index if exists public.launch_waitlist_wallet_key;
create unique index if not exists launch_waitlist_active_wallet_key
  on public.launch_waitlist (wallet)
  where wallet is not null and status in ('draft', 'whitelisted');
create unique index if not exists launch_waitlist_gate_fee_sig_key on public.launch_waitlist (gate_fee_sig) where gate_fee_sig is not null;
create unique index if not exists launch_waitlist_gate_loop_sig_key on public.launch_waitlist (gate_loop_sig) where gate_loop_sig is not null;
create unique index if not exists launch_waitlist_email_key on public.launch_waitlist (lower(email)) where email is not null;
alter table public.launch_waitlist enable row level security;
comment on table public.launch_waitlist is 'Pre-launch project drafts (the "when can I launch" demand). Service-role write via /api/waitlist; never publicly readable.';

-- ── waitlist-media storage bucket ────────────────────────────────────────────
-- Public bucket holding pre-launch banner + token images. Public so the stored
-- objects resolve at /storage/v1/object/public/waitlist-media/… (the only URLs
-- normalizeMediaUrl in lib/waitlist accepts). Uploads are server-side via the
-- service role (which bypasses storage RLS), so no anon write policy is needed;
-- the 2 MB + image-only limits are defence-in-depth alongside the API validation.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'waitlist-media', 'waitlist-media', true, 2097152,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── prelaunch_contributions ──────────────────────────────────────────────────
-- The pre-launch "vote with SOL" ledger: backers send SOL to a whitelisted
-- project's wallet (launch_waitlist.project_wallet) BEFORE the mint. Recorded
-- per-sender (dedup by tx_sig) so the deposit is REFUNDABLE if the project is
-- rejected / never launches. Synced from on-chain via getRecentContributions.
-- Service-role only (mirrors launch_waitlist): RLS on, no policies.
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
alter table public.prelaunch_contributions enable row level security;
create index if not exists prelaunch_contributions_draft_idx on public.prelaunch_contributions (draft_wallet);
comment on table public.prelaunch_contributions is 'Pre-launch "vote with SOL" deposits to a project wallet, refundable until launch. Service-role only.';

-- ── project_secrets ──────────────────────────────────────────────────────────
-- Per-project encrypted secrets (the multi-tenant compute key): each project can
-- BYO its own Anthropic key (billed to its founder, not Loop). Values are AES-256-
-- GCM ciphertext (lib/project-secrets), decrypted server-side only and gated on the
-- PROJECT_SECRETS_KEY master key. Service-role only: RLS on, no policies.
create table if not exists public.project_secrets (
  project_key text primary key,
  anthropic_key_enc text,
  updated_at timestamptz not null default now()
);
alter table public.project_secrets enable row level security;
comment on table public.project_secrets is 'Per-project encrypted secrets (BYO Anthropic key). Service-role only; AES-256-GCM ciphertext.';

-- ── follows ──────────────────────────────────────────────────────────────────
-- Wallet-to-wallet follow graph. Public read; writes service-role only after a
-- signed looplabs.fun profile proof of the follower (no anon write policy).
create table if not exists public.follows (
  follower   text not null,
  following  text not null,
  created_at timestamptz not null default now(),
  primary key (follower, following),
  constraint follows_no_self check (follower <> following)
);
create index if not exists follows_following_idx on public.follows (following, created_at desc);
create index if not exists follows_follower_idx  on public.follows (follower,  created_at desc);
alter table public.follows enable row level security;
create policy "follows are publicly readable" on public.follows for select using (true);

-- ── notifications ────────────────────────────────────────────────────────────
-- Per-recipient feed. PRIVATE: RLS on with NO policies, so only the service role
-- (behind a signed-proof API route) can read/write — a wallet's notifications are
-- unreadable by anyone else.
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  recipient  text not null,
  type       text not null,                 -- 'follow' | 'escalation' | ...
  actor      text,
  data       jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications (recipient, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (recipient) where read = false;
create unique index if not exists notifications_follow_uniq
  on public.notifications (recipient, actor) where type = 'follow';
alter table public.notifications enable row level security;

-- ── messages (DMs) ───────────────────────────────────────────────────────────
-- Wallet-to-wallet DMs. PRIVATE like notifications: RLS on, no policy →
-- service-role only behind a signed-proof session; readable only by its parties.
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  sender     text not null,
  recipient  text not null,
  body       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now(),
  constraint messages_no_self check (sender <> recipient)
);
create index if not exists messages_sender_idx    on public.messages (sender, created_at desc);
create index if not exists messages_recipient_idx on public.messages (recipient, created_at desc);
create index if not exists messages_unread_idx on public.messages (recipient) where read = false;
alter table public.messages enable row level security;

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
-- SECURITY (do not "fix" the advisor by adding a policy): RLS is enabled with NO
-- policy ON PURPOSE. `secret_key` holds spendable mint private keys, so the table
-- must be default-deny — anon/authenticated get zero rows; only service_role (which
-- bypasses RLS) and the SECURITY DEFINER claim fn below may touch it. Supabase's
-- `rls_enabled_no_policy` linter flags this as INFO because for a normal table it
-- means "locked out by mistake"; here the lockout IS the protection. Adding a
-- readable policy would leak every vanity secret key.
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
  -- 'planned' = an epic parent whose subtasks (parent_id) flow through the
  -- normal todo/building/shipped loop; the scheduler never picks it directly.
  status text not null default 'todo' check (status in ('todo','building','shipped','blocked','planned')),
  -- Backlog ranking: curated impact rank (higher works first) + provenance, so
  -- founder/holder asks outrank agent self-groomed work (lib/agent-backlog).
  priority smallint not null default 0,
  source text not null default 'agent' check (source in ('founder','holder','agent')),
  -- ROI per tick (lib/agent-impact): vitals captured at ship time (treasury SOL,
  -- volume, market cap), reconciled at J+7 into a 0..100 impact score.
  ship_snapshot jsonb,
  impact_score smallint,
  impact_at timestamptz,
  -- Epic linkage: subtasks point at their parent epic (null for standalone).
  parent_id bigint references public.agent_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.agent_tasks is 'Tasks the project agent plans and works. Written by the runtime (service_role); publicly readable.';
create index if not exists agent_tasks_backlog_idx on public.agent_tasks (project_key, status, priority desc, created_at);
create index if not exists agent_tasks_parent_idx on public.agent_tasks (parent_id) where parent_id is not null;

create table if not exists public.agent_emails (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  direction text not null check (direction in ('out','in')),
  party text not null,
  subject text not null,
  preview text not null default '',
  -- Full message body (newlines preserved), rendered in the inspector panel. The
  -- list row still shows the short `preview`. Nullable: legacy rows predate it.
  body text,
  created_at timestamptz not null default now()
);
comment on table public.agent_emails is 'Agent email inbox (sent/received). Written by the inbound webhook + send path (service_role); publicly readable.';

create table if not exists public.agent_posts (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  platform text not null default 'telegram' check (platform in ('twitter','reddit','telegram','farcaster','discord')),
  body text not null,
  likes integer not null default 0,
  replies integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.agent_posts is 'Social posts the agent published. Written by the runtime (service_role); publicly readable.';

-- Community messages the agent READS for memory (the inbound side of Discord —
-- the counterpart of agent_posts' outbound). Polled from #general/#ideas each
-- tick via lib/discord-read.ts and surfaced into the decision context as
-- untrusted DATA. NOT publicly readable (community chatter may carry PII):
-- RLS on with no public policy, so only the service_role can read/write it.
create table if not exists public.discord_messages (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  channel_id text not null,
  channel_name text,
  message_id text not null,
  author_id text,
  author_name text,
  content text not null,
  created_at timestamptz not null default now(),
  unique (project_key, message_id)
);
comment on table public.discord_messages is 'Discord community messages the agent ingests for memory. Written + read by the runtime (service_role) only; not publicly readable.';

create table if not exists public.x_mentions (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  tweet_id text not null,
  author_id text,
  author_username text,
  text text not null,
  created_at timestamptz not null default now(),
  unique (project_key, tweet_id)
);
comment on table public.x_mentions is 'X (Twitter) replies/mentions the agent ingests for memory + analysis. Written + read by the runtime (service_role) only; not publicly readable.';
alter table public.x_mentions enable row level security;

-- Discord ingest tracks whether the agent has already replied to a message.
alter table public.discord_messages add column if not exists answered boolean not null default false;

create table if not exists public.telegram_messages (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  update_id bigint not null,
  chat_id text not null,
  message_id text,
  author_name text,
  content text not null,
  answered boolean not null default false,
  created_at timestamptz not null default now(),
  unique (project_key, update_id)
);
comment on table public.telegram_messages is 'Telegram messages addressed to the agent (questions) the bot ingests to answer. Written + read by the runtime (service_role) only; not publicly readable.';
alter table public.telegram_messages enable row level security;

create table if not exists public.agent_escalations (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  body text not null,
  -- Typed agent→founder request queue (docs/admin-cockpit.md §A):
  --   credential — needs an API key/secret (founder input → project_secrets)
  --   action     — needs a manual founder action (founder marks Done)
  --   decision   — out-of-mandate decision (Adopt / Decline; the legacy default)
  --   info       — a question; founder's free-text answer is read by the agent next tick
  kind text not null default 'decision' check (kind in ('credential','action','decision','info')),
  -- The founder's free-text answer (for info requests) or a resolution note.
  response text,
  status text not null default 'open' check (status in ('open','applied','adopted','declined','done')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
comment on table public.agent_escalations is 'Typed agent→founder request queue (credential/action/decision/info). Written by the runtime (service_role); publicly readable.';

create table if not exists public.agent_actions (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
comment on table public.agent_actions is 'Streamed agent action log (console feed). Written by the runtime (service_role); publicly readable.';

-- One social content-strategy plan per project. The agent authors it the first time
-- public posting is enabled (social warm-up); X/Telegram broadcasting is GATED on a
-- row existing here, so the agent prepares a real strategy before it ever posts.
create table if not exists public.agent_social_plan (
  project_key text primary key references public.projects(key) on delete cascade,
  plan text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.agent_social_plan is 'Per-project social content plan the agent authors before it may post (social warm-up gate). Written by the runtime (service_role); publicly readable.';
create index if not exists agent_social_plan_project_idx on public.agent_social_plan (project_key);
alter table public.agent_social_plan enable row level security;
create policy "agent_social_plan public read" on public.agent_social_plan for select to public using (true);

-- Per-project OPERATOR knobs (Lot 5) with env fallback. Generic key/value the
-- founder edits per project; the runtime reads `{...process.env, ...overrides}`
-- so an unset key uses the platform env default. service_role only — these are
-- operator controls, NOT public (no public-read policy, unlike the feed tables).
create table if not exists public.project_config (
  project_key text not null references public.projects(key) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (project_key, key)
);
comment on table public.project_config is 'Per-project operator knobs (env-fallback). service_role only.';
create index if not exists project_config_project_idx on public.project_config (project_key);
alter table public.project_config enable row level security;

create index if not exists agent_tasks_project_idx      on public.agent_tasks      (project_key, created_at desc);
create index if not exists agent_emails_project_idx     on public.agent_emails     (project_key, created_at desc);
create index if not exists agent_posts_project_idx      on public.agent_posts      (project_key, created_at desc);
create index if not exists discord_messages_cursor_idx   on public.discord_messages (project_key, channel_id, message_id desc);
create index if not exists agent_escalations_project_idx on public.agent_escalations(project_key, created_at desc);
create index if not exists agent_escalations_open_kind_idx on public.agent_escalations(project_key, status, kind);
create index if not exists agent_actions_project_idx    on public.agent_actions    (project_key, created_at desc);

alter table public.agent_tasks      enable row level security;
alter table public.agent_emails     enable row level security;
alter table public.agent_posts      enable row level security;
alter table public.discord_messages enable row level security; -- service_role only (no public policy)
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

-- ── agent_chat ───────────────────────────────────────────────────────────────
-- Paid 1:1 questions to the project agent ($LOOP-metered; a boost jumps the
-- queue). A row is inserted via the "use server" submitChatAction ONLY AFTER the
-- sender's on-chain $LOOP transfer to the treasury — service_role only, no anon
-- insert (the paid gate is the spam control). The agent answers on its run.
create table if not exists public.agent_chat (
  id          bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  wallet      text not null check (char_length(wallet) between 1 and 64),
  question    text not null check (char_length(question) between 1 and 600),
  answer      text check (answer is null or char_length(answer) <= 2000),
  loop_paid   double precision not null default 0 check (loop_paid >= 0),
  boost       double precision not null default 0 check (boost >= 0),
  tx_sig      text check (tx_sig is null or char_length(tx_sig) <= 128),
  status      text not null default 'open' check (status in ('open','answered')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists agent_chat_project_idx on public.agent_chat (project_key, created_at desc);
create index if not exists agent_chat_open_idx    on public.agent_chat (project_key, status, boost desc);
-- One verified payment ⇒ one question: a transaction signature can back only a
-- single chat row (submitChatAction also checks, this is the hard backstop).
create unique index if not exists agent_chat_txsig_uniq on public.agent_chat (tx_sig) where tx_sig is not null;
alter table public.agent_chat enable row level security;
create policy "agent_chat public read" on public.agent_chat for select to public using (true);
comment on table public.agent_chat is 'Paid 1:1 questions to the project agent ($LOOP-metered; boost jumps the queue). Inserted via submitChatAction AFTER the on-chain $LOOP transfer to the treasury (service_role only — no anon insert). The agent answers on its run. Publicly readable.';

-- ── directives ───────────────────────────────────────────────────────────────
create table if not exists public.directives (
  id uuid primary key default gen_random_uuid(),
  project_key text not null references public.projects(key) on delete cascade,
  kind text not null default 'directive' check (kind in ('directive', 'proposal')),
  text text not null check (char_length(text) between 1 and 600),
  author_wallet text check (author_wallet is null or char_length(author_wallet) <= 64),
  -- True only when author_wallet ownership was proven by an ed25519 signature.
  -- Anon may never set this true (see the insert policy), so an attribution shown
  -- as "verified" can't be self-declared — it closes the author-spoofing vector.
  verified boolean not null default false,
  role text not null default 'holder' check (role in ('founder', 'holder')),
  status text not null default 'open' check (status in ('open', 'applied', 'adopted', 'declined')),
  for_votes integer not null default 0 check (for_votes >= 0),
  against_votes integer not null default 0 check (against_votes >= 0),
  -- Quorum is proportional to the holder base (~1/10, min 3) at insert time
  -- (lib/directives.ts proposalQuorum); the default is the floor so a row written
  -- without one is still resolvable rather than stuck at an unreachable 100.
  quorum integer not null default 3 check (quorum > 0),
  -- Moderated out of the public feed: the agent auto-hides obvious abuse and the
  -- founder can hide anything. Kept in the table (not deleted) for traceability;
  -- the public read in lib/agent-data.ts filters these out.
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.directives is 'Steering directives submitted via the Agent Console. Anon may insert only an UNVERIFIED, unattributed open/holder submission; verified/attributed rows and status promotion are service_role-only. Publicly readable. Never authoritative — the runtime treats directive text as untrusted data.';
create index if not exists directives_project_created_idx on public.directives (project_key, created_at desc);
-- Idempotent migrations for an already-provisioned DB (the create-table above is
-- a no-op once the table exists).
alter table public.directives add column if not exists hidden boolean not null default false;
alter table public.directives alter column quorum set default 3;
-- Founder execution-triage for an ADOPTED proposal: what happens to a holder ask
-- the vote already passed — 'done' (already shipped), 'todo' (queued for the
-- agent to build next), 'refused' (founder overrides the vote). NULL until the
-- founder triages. Distinct from `status` (the adoption lifecycle): a proposal is
-- adopted by vote first, then the founder sets exec. Service-role-only to write
-- (founder gate in setProposalExecAction); publicly readable like the rest.
alter table public.directives add column if not exists exec text
  check (exec is null or exec in ('todo','done','refused'));
-- Paid steering (pay-to-ask, pay-to-steer): the on-chain $LOOP transfer that
-- funded this submission, and the amount that actually reached the treasury.
-- Recorded only on the verified service_role path (submitDirectiveAction); anon
-- inserts never set them. The unique index replay-guards one payment ⇒ one row.
alter table public.directives add column if not exists tx_sig text
  check (tx_sig is null or char_length(tx_sig) <= 128);
alter table public.directives add column if not exists loop_paid double precision not null default 0
  check (loop_paid >= 0);
create unique index if not exists directives_txsig_uniq on public.directives (tx_sig) where tx_sig is not null;
alter table public.directives enable row level security;
create policy "directives are publicly readable" on public.directives for select using (true);
create policy "anon can submit a safe directive (prototype)" on public.directives for insert to anon
  with check (
    kind in ('directive', 'proposal')
    and char_length(text) between 1 and 600
    and status = 'open' and role = 'holder'
    and for_votes = 0 and against_votes = 0
    -- No self-declared author or verification: an unsigned submission is anonymous
    -- and unverified. Attributing a wallet (e.g. the founder's) requires a signed
    -- insert through service_role, so a direct REST call can't spoof authorship.
    and author_wallet is null
    and verified = false
    -- Anon can't pre-hide or unhide: moderation (auto-abuse + founder) writes via
    -- service_role only.
    and hidden = false
    -- Anon can't spoof a paid submission: recording a verified on-chain payment
    -- (tx_sig + loop_paid) is the service_role path's job only. A free anon insert
    -- is always unpaid, so a direct REST call can't forge a "paid" steering row.
    and tx_sig is null
    and loop_paid = 0
  );

-- ── stakes (stake-to-participate) ────────────────────────────────────────────
-- A holder stakes $LOOP to unlock steering the agent (ask / propose) WITHOUT a
-- per-message on-chain transfer — that transfer is what Phantom/Blowfish flagged
-- as a scam on a new domain+token, while a signed message moves no funds. A stake
-- is an ed25519-signed commitment; v1 takes NO custody (the $LOOP stays in the
-- holder's wallet, and submitStakeAction + the participation gate re-read the live
-- on-chain balance, so a stake can't be gamed by staking then dumping). Locked
-- custody + the yield split (founder/agent/platform) are v2/v3. Written
-- service_role only; publicly readable.
create table if not exists public.stakes (
  id uuid primary key default gen_random_uuid(),
  project_key text not null references public.projects(key) on delete cascade,
  wallet text not null check (char_length(wallet) between 1 and 64),
  amount double precision not null check (amount >= 0),
  -- The signed commitment that authorized this row (kept for audit), bounded.
  message text check (message is null or char_length(message) <= 500),
  signature text check (signature is null or char_length(signature) <= 200),
  -- Only the latest stake per (project, wallet) is active; a superseded row is
  -- deactivated (kept for history) when a newer stake lands.
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists stakes_project_wallet_active_idx
  on public.stakes (project_key, wallet, active, created_at desc);
alter table public.stakes enable row level security;
create policy "stakes are publicly readable" on public.stakes for select using (true);
-- No anon insert/update/delete: a stake is recorded only via submitStakeAction
-- (service_role), which verifies the ed25519 signature AND that the wallet really
-- holds the staked $LOOP on-chain. A direct REST call can't forge a stake row.

-- ── directive votes (holder voting on proposals) ─────────────────────────────
-- One vote per (proposal, voter wallet); re-voting flips the side. The cached
-- directives.for_votes/against_votes are kept in sync ONLY by cast_directive_vote
-- (the single, SECURITY DEFINER write path), so anon never touches the counts or
-- this table directly. `weight` is 1 today; token-weighting is a future upgrade.
create table if not exists public.directive_votes (
  directive_id uuid not null references public.directives(id) on delete cascade,
  voter text not null check (char_length(voter) between 1 and 64),
  dir text not null check (dir in ('for', 'against')),
  weight integer not null default 1 check (weight > 0),
  created_at timestamptz not null default now(),
  primary key (directive_id, voter)
);
alter table public.directive_votes enable row level security;
create policy "directive_votes are publicly readable" on public.directive_votes for select using (true);
-- No anon/authenticated insert/update/delete policy: writes go only through the
-- definer RPC below, which dedupes by wallet and recomputes the cached tallies.

create or replace function public.cast_directive_vote(
  p_directive_id uuid,
  p_voter text,
  p_dir text
) returns table (for_votes integer, against_votes integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_for integer;
  v_against integer;
begin
  if p_dir not in ('for', 'against') then
    raise exception 'dir must be for or against';
  end if;
  if p_voter is null or char_length(p_voter) = 0 or char_length(p_voter) > 64 then
    raise exception 'invalid voter';
  end if;
  -- Only proposals are votable (directives are not put to a vote).
  if not exists (
    select 1 from public.directives d
    where d.id = p_directive_id and d.kind = 'proposal'
  ) then
    raise exception 'not a votable proposal';
  end if;

  insert into public.directive_votes (directive_id, voter, dir)
  values (p_directive_id, p_voter, p_dir)
  on conflict (directive_id, voter)
    do update set dir = excluded.dir, created_at = now();

  select
    coalesce(sum(weight) filter (where dir = 'for'), 0),
    coalesce(sum(weight) filter (where dir = 'against'), 0)
  into v_for, v_against
  from public.directive_votes
  where directive_id = p_directive_id;

  update public.directives
    set for_votes = v_for, against_votes = v_against
    where id = p_directive_id;

  return query select v_for, v_against;
end;
$$;

-- service_role-only: the vote is cast from the "use server" castVoteAction (the
-- trusted call site), never directly from the browser. Keeping a SECURITY DEFINER
-- function off the anon/authenticated API keeps the security advisors clean.
revoke all on function public.cast_directive_vote(uuid, text, text) from public;
grant execute on function public.cast_directive_vote(uuid, text, text) to service_role;

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

-- ── device_assists (Loop Compute v1) ─────────────────────────────────────────
create table if not exists public.device_assists (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  task_id bigint references public.agent_tasks(id) on delete set null,
  job_id text not null,
  title text not null,
  device_id text not null default '',
  device_name text,
  complexity text,
  keywords text[] not null default '{}',
  prep_brief text not null,
  result_hash text not null default '',
  source text not null default 'loop-compute',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_key, job_id)
);
comment on table public.device_assists is 'Device-pool prep briefs for agent backlog (Loop Compute). Service-role write; public read.';
create index if not exists device_assists_project_unread_idx
  on public.device_assists (project_key, created_at desc) where consumed_at is null;
alter table public.device_assists enable row level security;
create policy "device_assists public read" on public.device_assists for select to anon, authenticated using (true);

-- LOOP will soon have both a Solana AND a Hood treasury, so a compute
-- contributor needs both a Solana payout address (payout_address above) and
-- a Hood/EVM payout address, linked via app/api/compute/link-hood
-- (lib/evm-signature.ts verifies the EIP-191 proof server-side).
alter table public.device_assists add column if not exists payout_address_hood text;
comment on column public.device_assists.payout_address_hood is 'Contributor EVM wallet, linked via app/api/compute/link-hood — pays ETH when the funding project''s treasury is on Hood rather than Solana.';

-- Per-project LAST TICK ATTEMPT (written by the cron BEFORE the heavy E2B build).
-- lastTickAt() (lib/agent-data) takes the later of this and the newest agent_tasks
-- row, so a tick that times out (the heavy LOOP repo overruns the 300s function
-- budget) still advances the project's "last ticked" marker — otherwise fair
-- scheduling re-picks it first on every fire and starves the others (deadlock).
create table if not exists public.agent_tick_attempts (
  project_key text primary key,
  attempted_at timestamptz not null default now()
);
comment on table public.agent_tick_attempts is 'Last tick-attempt time per project (written before the heavy build) so fair scheduling advances even when a tick times out.';
alter table public.agent_tick_attempts enable row level security;

-- ── repo_locks ────────────────────────────────────────────────────────────────
-- Cross-project push serialization: one row per GitHub repo, held by whichever
-- project's agent tick is currently pushing. TTL-expiring so a crashed/
-- never-finished session cannot deadlock the repo forever. Needed once two
-- independent project rows (e.g. LOOP-Solana + LOOP-Hood) can share one repo
-- and tick on independent cadences (lib/repo-lock.ts).
create table if not exists public.repo_locks (
  repo_slug text primary key,
  locked_by text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null
);
comment on table public.repo_locks is 'Cross-project push serialization: one row per GitHub repo, held by whichever project''s agent tick is currently pushing. TTL-expiring so a crashed/never-finished session cannot deadlock the repo forever (lib/repo-lock.ts).';
alter table public.repo_locks enable row level security;
-- Service-role only (no anon/authenticated policies) — acquire/release happen
-- server-side via the SECURITY DEFINER functions below, never client-side.

create or replace function public.acquire_repo_lock(p_repo_slug text, p_project_key text, p_ttl_minutes int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.repo_locks (repo_slug, locked_by, locked_at, expires_at)
  values (p_repo_slug, p_project_key, now(), now() + (p_ttl_minutes || ' minutes')::interval)
  on conflict (repo_slug) do update
    set locked_by = excluded.locked_by,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    where public.repo_locks.expires_at < now() or public.repo_locks.locked_by = p_project_key;
  return found;
end;
$$;
revoke all on function public.acquire_repo_lock(text, text, int) from public, anon, authenticated;
grant execute on function public.acquire_repo_lock(text, text, int) to service_role;

create or replace function public.release_repo_lock(p_repo_slug text, p_project_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.repo_locks where repo_slug = p_repo_slug and locked_by = p_project_key;
$$;
revoke all on function public.release_repo_lock(text, text) from public, anon, authenticated;
grant execute on function public.release_repo_lock(text, text) to service_role;

-- ── treasury_checks ──────────────────────────────────────────────────────────
-- Redundant treasury-balance verification by the device pool — the compute
-- pool's first job type that needs ZERO Claude/LLM anywhere in its lifecycle
-- (dispatch, execution, or verification), unlike the prep-brief work, which
-- only exists to feed an agent's LLM prompt. Multiple devices independently
-- read the SAME on-chain balance for the same 5-minute bucket; k-redundancy
-- consensus (mirrors lib/compute-consensus.ts) flags disagreement. See
-- lib/treasury-checks.ts.
create table if not exists public.treasury_checks (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  wallet text not null,
  bucket_ts timestamptz not null,
  lamports bigint not null,
  device_id text not null,
  device_name text,
  payout_address text,
  payout_address_hood text,
  consensus_ok boolean,
  created_at timestamptz not null default now(),
  unique (project_key, bucket_ts, device_id)
);
comment on table public.treasury_checks is 'Redundant device-pool reads of a project treasury balance, cross-checked by k-redundancy consensus (lib/treasury-checks.ts) — zero LLM involvement anywhere in this job type.';
create index if not exists treasury_checks_bucket_idx
  on public.treasury_checks (project_key, bucket_ts desc);
alter table public.treasury_checks enable row level security;
create policy "treasury_checks public read" on public.treasury_checks for select to anon, authenticated using (true);

-- ── Phase A: LOOP-only (close public project creation) ───────────────────────
-- No anon insert policy on projects → only the service-role launch script can
-- create a project. Reopen with a hardened insert policy for the public phase.
-- (Intentionally no "anon can launch" policy is created above.)
