-- Per-project encrypted secrets (the multi-tenant compute key): each project can
-- BYO its own Anthropic key. AES-256-GCM ciphertext, service-role only. Idempotent.
create table if not exists public.project_secrets (
  project_key text primary key,
  anthropic_key_enc text,
  updated_at timestamptz not null default now()
);
alter table public.project_secrets enable row level security;
