-- Dedupe store for the Hood LOOP buy-alert bot (app/api/hood-buybot). One row
-- per posted buy tx; the unique tx_hash makes the poll idempotent, so the cron
-- can safely re-scan an overlapping block window without double-posting.

create table if not exists public.hood_buys (
  tx_hash    text primary key,
  posted_at  timestamptz not null default now()
);

-- Service-role only (the cron writes with the service key). No public access.
alter table public.hood_buys enable row level security;
