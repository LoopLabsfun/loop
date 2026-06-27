-- Pre-launch project drafts — paste this whole block into the Supabase SQL editor
-- (project ref aysetvbjlzhnswkznxjh) to upgrade the waitlist from contact-capture
-- into a real "draft your project" form. Idempotent: safe to run more than once.
--
-- It (1) adds the draft columns to launch_waitlist and (2) creates the public
-- waitlist-media bucket that holds banner + token images. The app degrades
-- gracefully if this hasn't run yet (it still captures the lead + opens the DM),
-- so running it just unlocks full draft + image persistence.

-- 1) launch_waitlist draft columns
alter table public.launch_waitlist add column if not exists name text;
alter table public.launch_waitlist add column if not exists ticker text;
alter table public.launch_waitlist add column if not exists banner_url text;
alter table public.launch_waitlist add column if not exists token_image_url text;
alter table public.launch_waitlist add column if not exists fee_founder_pct int;
alter table public.launch_waitlist add column if not exists prompt text;
alter table public.launch_waitlist add column if not exists repo text;
alter table public.launch_waitlist add column if not exists updated_at timestamptz;

-- 2) public waitlist-media bucket (banner + token images, 2 MB, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'waitlist-media', 'waitlist-media', true, 2097152,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
