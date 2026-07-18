-- Device compute assists (Loop Compute v1)
-- Local devices prepare backlog tasks; the agent tick reads unread rows.
-- Safe to re-run.

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
-- Writes: service_role only (no insert/update policies for anon).
