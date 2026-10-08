-- Migration 024: background notifications for the Android app, without Firebase or any paid service.
-- The app checks about every 15 minutes with its own random key (only a SHA-256 hash is stored). The key can
-- only read the player's own new notifications (who and what kind); it cannot sign in or change anything.
-- Additive only: one new table and three functions callable only by service_role.

create table if not exists public.bq_notify_tokens (
  token_hash text primary key check (char_length(token_hash) = 64),
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists bq_notify_tokens_profile_idx on public.bq_notify_tokens (profile_id, created_at desc);
alter table public.bq_notify_tokens enable row level security;
revoke all on public.bq_notify_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.bq_notify_tokens to service_role;

-- A new key for this phone. At most 5 phones per player; keys unused for 60 days are removed.
create or replace function public.bq_notify_register(p_profile_id uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  delete from public.bq_notify_tokens where last_used_at < now() - interval '60 days';
  insert into public.bq_notify_tokens (token_hash, profile_id) values (p_token_hash, p_profile_id) on conflict (token_hash) do nothing;
  delete from public.bq_notify_tokens where profile_id = p_profile_id and token_hash in (
    select token_hash from public.bq_notify_tokens where profile_id = p_profile_id order by created_at desc offset 5);
  return jsonb_build_object('ok', true);
end; $$;

-- New unread notifications after the last one the phone showed (at most 10, from the last 3 days).
-- p_stop removes the key (sign out on that phone).
create or replace function public.bq_notify_check(p_token_hash text, p_after bigint, p_stop boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare who uuid; is_on boolean;
begin
  select profile_id into who from public.bq_notify_tokens where token_hash = p_token_hash;
  if who is null then return jsonb_build_object('ok', false, 'code', 'session_expired'); end if;
  if coalesce(p_stop, false) then
    delete from public.bq_notify_tokens where token_hash = p_token_hash;
    return jsonb_build_object('ok', true, 'stopped', true, 'items', '[]'::jsonb);
  end if;
  update public.bq_notify_tokens set last_used_at = now() where token_hash = p_token_hash;
  select notifications_enabled into is_on from public.bq_profiles where id = who;
  return jsonb_build_object('ok', true, 'enabled', coalesce(is_on, false),
    'latest', coalesce((select max(id) from public.bq_notifications where profile_id = who), 0),
    'items', case when coalesce(is_on, false) then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'actor', t.actor, 'body', left(t.body, 200)) order by t.id)
      from (select n.id, n.kind, p.display_name as actor, case when n.kind in ('announcement', 'feedback_reply') then n.body else '' end as body
        from public.bq_notifications n left join public.bq_profiles p on p.id = n.actor_id
        where n.profile_id = who and n.read_at is null and n.id > coalesce(p_after, 0) and n.created_at > now() - interval '3 days'
        order by n.id desc limit 10) t), '[]'::jsonb) else '[]'::jsonb end);
end; $$;

-- Removes every phone key of a player (used when they turn notifications off everywhere or delete data).
create or replace function public.bq_notify_forget(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.bq_notify_tokens where profile_id = p_profile_id;
  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.bq_notify_register(uuid, text) from public, anon, authenticated;
revoke all on function public.bq_notify_check(text, bigint, boolean) from public, anon, authenticated;
revoke all on function public.bq_notify_forget(uuid) from public, anon, authenticated;
grant execute on function public.bq_notify_register(uuid, text) to service_role;
grant execute on function public.bq_notify_check(text, bigint, boolean) to service_role;
grant execute on function public.bq_notify_forget(uuid) to service_role;
