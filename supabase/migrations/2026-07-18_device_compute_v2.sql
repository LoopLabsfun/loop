-- Loop Compute v2 — contributor identity + task claims.
-- Includes the v1 device_assists table (safe to re-run) so this one file
-- can be pasted into the Supabase SQL editor in a single pass.

-- ── v1: device_assists (unchanged, idempotent) ──────────────────────────────
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

comment on table public.device_assists is
  'Device-pool prep briefs for agent backlog items (Loop Compute). Service-role write; public read.';

create index if not exists device_assists_project_unread_idx
  on public.device_assists (project_key, created_at desc)
  where consumed_at is null;

create index if not exists device_assists_task_idx
  on public.device_assists (task_id);

alter table public.device_assists enable row level security;

drop policy if exists "device_assists public read" on public.device_assists;
create policy "device_assists public read"
  on public.device_assists for select to anon, authenticated using (true);

-- ── v2: contributor identity ────────────────────────────────────────────────
-- The wallet that earns the reward for this assist (device owner's payout).
alter table public.device_assists
  add column if not exists payout_address text;

create index if not exists device_assists_payout_idx
  on public.device_assists (payout_address)
  where payout_address is not null;

-- ── v2: task claims — cooperative scheduling for the device pool ────────────
-- A device claims (project_key, task_id) before working so the pool doesn't
-- duplicate effort. Claims expire; a completed claim points at the assist.
-- Service-role write only (the ingest API arbitrates); public read.
-- One row per (project, task): claiming is an atomic upsert that only steals
-- the row when the previous claim is completed or expired. now() can't live
-- in an index predicate, so the expiry check happens in the upsert's WHERE.
create table if not exists public.device_job_claims (
  id bigint generated always as identity primary key,
  project_key text not null references public.projects(key) on delete cascade,
  task_id bigint not null,
  device_id text not null,
  device_name text,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  completed_at timestamptz,
  assist_job_id text,
  unique (project_key, task_id)
);

comment on table public.device_job_claims is
  'Loop Compute pool scheduling: one claim row per (project, task); atomic conditional upsert arbitrates.';

create index if not exists device_job_claims_device_idx
  on public.device_job_claims (device_id, claimed_at desc);

alter table public.device_job_claims enable row level security;

drop policy if exists "device_job_claims public read" on public.device_job_claims;
create policy "device_job_claims public read"
  on public.device_job_claims for select to anon, authenticated using (true);

-- Atomic claim: grants when the task is unclaimed, or the previous claim is
-- completed/expired. Returns the winning holder either way.
create or replace function public.claim_device_task(
  p_project text,
  p_task bigint,
  p_device text,
  p_device_name text default null,
  p_ttl_minutes int default 10
) returns table (granted boolean, holder_device text, holder_expires timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  won record;
begin
  insert into device_job_claims as c
    (project_key, task_id, device_id, device_name, claimed_at, expires_at)
  values
    (p_project, p_task, p_device, p_device_name, now(), now() + make_interval(mins => p_ttl_minutes))
  on conflict (project_key, task_id) do update
    set device_id = excluded.device_id,
        device_name = excluded.device_name,
        claimed_at = now(),
        expires_at = excluded.expires_at,
        completed_at = null,
        assist_job_id = null
    where c.completed_at is not null or c.expires_at < now()
  returning c.device_id, c.expires_at into won;

  if won.device_id is not null then
    return query select true, won.device_id, won.expires_at;
  else
    return query
      select false, c.device_id, c.expires_at
      from device_job_claims c
      where c.project_key = p_project and c.task_id = p_task;
  end if;
end;
$$;

revoke all on function public.claim_device_task from public, anon, authenticated;
