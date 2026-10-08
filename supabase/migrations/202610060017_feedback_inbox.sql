-- Migration 017: player feedback (Settings > Send feedback) and the admin feedback inbox.
-- Additive only: two new tables, no change to any existing table, row, or function. Requires migrations 001-016.
-- Players reach these tables only through the blind-quiz-api Edge Function (service_role); clients get no access.
-- Requested by the owner on 6 Oct 2026. Applied only by .github/workflows/apply-migration-017.yml.
begin;
create table if not exists public.bq_admins (
  profile_id uuid primary key references public.bq_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.bq_feedback (
  id bigint generated always as identity primary key,
  profile_id uuid references public.bq_profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 40),
  kind text not null check (kind in ('feedback', 'problem', 'idea')),
  message text not null check (char_length(message) between 5 and 2000),
  screenshot text check (screenshot is null or (char_length(screenshot) <= 900000 and screenshot ~ '^data:image/(jpeg|png|webp);base64,')),
  has_screenshot boolean generated always as (screenshot is not null) stored,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists bq_feedback_created_idx on public.bq_feedback (created_at desc);
alter table public.bq_admins enable row level security;
alter table public.bq_feedback enable row level security;
revoke all on public.bq_admins, public.bq_feedback from public, anon, authenticated;
grant select, insert, update, delete on public.bq_admins, public.bq_feedback to service_role;
-- The game owner's account, Goldfish, is the admin who reads the feedback inbox.
insert into public.bq_admins (profile_id) select id from public.bq_profiles where name_normalized = 'goldfish' on conflict (profile_id) do nothing;
commit;
