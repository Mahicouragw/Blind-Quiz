-- Migration 019: notifications, feedback replies, online presence and friends (Multiplayer, stage 1).
-- Additive only: new columns with defaults on bq_profiles and bq_feedback, two new tables, new functions.
-- No existing row, column, or function is changed. Requires migrations 001-018.
-- Everything is reached only through the blind-quiz-api Edge Function (service_role); the profile id always comes
-- from the server-side session. Public player cards never include the Login ID, secret question, or any hash.
-- Requested by the owner on 6 Oct 2026. Applied only by .github/workflows/apply-migration-019.yml.
begin;
alter table public.bq_profiles add column if not exists last_seen_at timestamptz;
alter table public.bq_profiles add column if not exists notifications_enabled boolean not null default true;
alter table public.bq_feedback add column if not exists reply text check (reply is null or char_length(reply) between 1 and 2000);
alter table public.bq_feedback add column if not exists replied_at timestamptz;
create index if not exists bq_profiles_last_seen_idx on public.bq_profiles (last_seen_at desc);

create table if not exists public.bq_notifications (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'message', 'feedback_reply', 'announcement', 'room_invite', 'game_invite')),
  actor_id uuid references public.bq_profiles(id) on delete set null,
  ref text check (ref is null or char_length(ref) <= 100),
  body text not null default '' check (char_length(body) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists bq_notifications_profile_idx on public.bq_notifications (profile_id, created_at desc);

create table if not exists public.bq_friendships (
  requester_id uuid not null references public.bq_profiles(id) on delete cascade,
  addressee_id uuid not null references public.bq_profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
create unique index if not exists bq_friendships_pair_idx on public.bq_friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists bq_friendships_addressee_idx on public.bq_friendships (addressee_id);

alter table public.bq_notifications enable row level security;
alter table public.bq_friendships enable row level security;
revoke all on public.bq_notifications, public.bq_friendships from public, anon, authenticated;
grant select, insert, update, delete on public.bq_notifications, public.bq_friendships to service_role;

-- Relationship between the caller and another player: none | outgoing | incoming | friends.
create or replace function public.bq_relation(p_me uuid, p_other uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select case when f.status = 'accepted' then 'friends' when f.requester_id = p_me then 'outgoing' else 'incoming' end
    from public.bq_friendships f
    where (f.requester_id = p_me and f.addressee_id = p_other) or (f.requester_id = p_other and f.addressee_id = p_me)), 'none');
$$;

-- Heartbeat: marks the caller online (at most one write every 15 seconds) and returns the unread count.
create or replace function public.bq_touch(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.bq_profiles set last_seen_at = now() where id = p_profile_id and (last_seen_at is null or last_seen_at < now() - interval '15 seconds');
  return jsonb_build_object('unread', (select count(*) from public.bq_notifications where profile_id = p_profile_id and read_at is null),
    'notificationsEnabled', (select notifications_enabled from public.bq_profiles where id = p_profile_id));
end; $$;

create or replace function public.bq_online_players(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'level', p.level, 'relation', public.bq_relation(p_profile_id, p.id)) order by p.last_seen_at desc), '[]'::jsonb)
  from (select * from public.bq_profiles where id <> p_profile_id and last_seen_at > now() - interval '2 minutes' order by last_seen_at desc limit 100) p;
$$;

-- Public player card: activity only. Never the Login ID, secret question, or hashes.
create or replace function public.bq_player_card(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.bq_profiles%rowtype;
begin
  select * into p from public.bq_profiles where name_normalized = p_name_normalized;
  if not found then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  return jsonb_build_object('ok', true, 'player', jsonb_build_object(
    'name', p.display_name, 'level', p.level, 'xp', p.xp, 'coins', p.coins,
    'questionsAnswered', p.questions_answered, 'questionsCorrect', p.questions_correct, 'quizzesCompleted', p.quizzes_completed,
    'bestStreak', p.best_streak,
    'wordsFound', (select count(*) from public.bq_word_finds where profile_id = p.id),
    'soundMatchGames', (select count(*) from public.bq_sound_match_games where profile_id = p.id and finished_at is not null),
    'memberSince', to_char(p.created_at, 'YYYY-MM'),
    'online', coalesce(p.last_seen_at > now() - interval '2 minutes', false),
    'self', p.id = p_profile_id,
    'relation', case when p.id = p_profile_id then 'self' else public.bq_relation(p_profile_id, p.id) end));
end; $$;

create or replace function public.bq_friend_request(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid; rel text;
begin
  select id into target from public.bq_profiles where name_normalized = p_name_normalized;
  if target is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if target = p_profile_id then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  rel := public.bq_relation(p_profile_id, target);
  if rel = 'friends' then return jsonb_build_object('ok', true, 'relation', 'friends'); end if;
  if rel = 'outgoing' then return jsonb_build_object('ok', true, 'relation', 'outgoing'); end if;
  if rel = 'incoming' then
    -- They already asked: sending a request back accepts theirs.
    update public.bq_friendships set status = 'accepted', responded_at = now() where requester_id = target and addressee_id = p_profile_id;
    update public.bq_notifications set read_at = coalesce(read_at, now()) where profile_id = p_profile_id and kind = 'friend_request' and actor_id = target;
    insert into public.bq_notifications (profile_id, kind, actor_id) values (target, 'friend_accepted', p_profile_id);
    return jsonb_build_object('ok', true, 'relation', 'friends');
  end if;
  if (select count(*) from public.bq_friendships where requester_id = p_profile_id and status = 'pending') >= 50 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  insert into public.bq_friendships (requester_id, addressee_id) values (p_profile_id, target);
  insert into public.bq_notifications (profile_id, kind, actor_id) values (target, 'friend_request', p_profile_id);
  return jsonb_build_object('ok', true, 'relation', 'outgoing');
end; $$;

create or replace function public.bq_friend_respond(p_profile_id uuid, p_name_normalized text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare requester uuid;
begin
  select f.requester_id into requester from public.bq_friendships f join public.bq_profiles p on p.id = f.requester_id
    where f.addressee_id = p_profile_id and f.status = 'pending' and p.name_normalized = p_name_normalized;
  if requester is null then return jsonb_build_object('ok', false, 'code', 'request_unavailable'); end if;
  update public.bq_notifications set read_at = coalesce(read_at, now()) where profile_id = p_profile_id and kind = 'friend_request' and actor_id = requester;
  if p_accept then
    update public.bq_friendships set status = 'accepted', responded_at = now() where requester_id = requester and addressee_id = p_profile_id;
    insert into public.bq_notifications (profile_id, kind, actor_id) values (requester, 'friend_accepted', p_profile_id);
    return jsonb_build_object('ok', true, 'relation', 'friends');
  end if;
  delete from public.bq_friendships where requester_id = requester and addressee_id = p_profile_id;
  return jsonb_build_object('ok', true, 'relation', 'none');
end; $$;

create or replace function public.bq_friend_remove(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  delete from public.bq_friendships where (requester_id = p_profile_id and addressee_id = other) or (requester_id = other and addressee_id = p_profile_id);
  return jsonb_build_object('ok', true, 'relation', 'none');
end; $$;

create or replace function public.bq_friends(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'level', p.level, 'online', coalesce(p.last_seen_at > now() - interval '2 minutes', false)) order by p.last_seen_at desc nulls last)
      from public.bq_friendships f join public.bq_profiles p on p.id = case when f.requester_id = p_profile_id then f.addressee_id else f.requester_id end
      where f.status = 'accepted' and (f.requester_id = p_profile_id or f.addressee_id = p_profile_id)), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'level', p.level) order by f.created_at desc)
      from public.bq_friendships f join public.bq_profiles p on p.id = f.requester_id where f.addressee_id = p_profile_id and f.status = 'pending'), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'level', p.level) order by f.created_at desc)
      from public.bq_friendships f join public.bq_profiles p on p.id = f.addressee_id where f.requester_id = p_profile_id and f.status = 'pending'), '[]'::jsonb));
$$;

create or replace function public.bq_notifications_list(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'actor', a.display_name, 'ref', n.ref, 'body', n.body,
      'createdAt', n.created_at, 'read', n.read_at is not null,
      'relation', case when n.kind = 'friend_request' and a.id is not null then public.bq_relation(p_profile_id, a.id) else null end) order by n.created_at desc), '[]'::jsonb)
  from (select * from public.bq_notifications where profile_id = p_profile_id order by created_at desc limit 60) n
  left join public.bq_profiles a on a.id = n.actor_id;
$$;

create or replace function public.bq_notifications_read(p_profile_id uuid, p_ids bigint[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.bq_notifications set read_at = now()
    where profile_id = p_profile_id and read_at is null and (p_ids is null or id = any(p_ids));
  return jsonb_build_object('ok', true, 'unread', (select count(*) from public.bq_notifications where profile_id = p_profile_id and read_at is null));
end; $$;

create or replace function public.bq_set_notifications(p_profile_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.bq_profiles set notifications_enabled = p_enabled where id = p_profile_id;
  return jsonb_build_object('ok', true, 'notificationsEnabled', p_enabled);
end; $$;

-- The player's own feedback with its status: sent, read by the admin, or replied (with the reply).
create or replace function public.bq_my_feedback(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'message', message, 'createdAt', created_at,
      'status', case when replied_at is not null then 'replied' when read_at is not null then 'read' else 'sent' end,
      'reply', reply, 'repliedAt', replied_at) order by created_at desc), '[]'::jsonb)
  from (select * from public.bq_feedback where profile_id = p_profile_id order by created_at desc limit 50) f;
$$;

-- Admin only (bq_admins): reply to a feedback message; the player gets a notification.
create or replace function public.bq_feedback_reply(p_admin_id uuid, p_feedback_id bigint, p_reply text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare author uuid;
begin
  if not exists (select 1 from public.bq_admins where profile_id = p_admin_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_reply is null or char_length(p_reply) < 1 or char_length(p_reply) > 2000 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  update public.bq_feedback set reply = p_reply, replied_at = now(), read_at = coalesce(read_at, now()) where id = p_feedback_id returning profile_id into author;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if author is not null then
    insert into public.bq_notifications (profile_id, kind, actor_id, ref, body) values (author, 'feedback_reply', p_admin_id, p_feedback_id::text, left(p_reply, 500));
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- Admin only: an announcement (for example "A new game was added") to every player.
create or replace function public.bq_announce(p_admin_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare sent integer;
begin
  if not exists (select 1 from public.bq_admins where profile_id = p_admin_id) then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if p_body is null or char_length(p_body) < 3 or char_length(p_body) > 500 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  insert into public.bq_notifications (profile_id, kind, actor_id, body) select id, 'announcement', p_admin_id, p_body from public.bq_profiles;
  get diagnostics sent = row_count;
  return jsonb_build_object('ok', true, 'sent', sent);
end; $$;

revoke all on function public.bq_relation(uuid, uuid), public.bq_touch(uuid), public.bq_online_players(uuid), public.bq_player_card(uuid, text),
  public.bq_friend_request(uuid, text), public.bq_friend_respond(uuid, text, boolean), public.bq_friend_remove(uuid, text), public.bq_friends(uuid),
  public.bq_notifications_list(uuid), public.bq_notifications_read(uuid, bigint[]), public.bq_set_notifications(uuid, boolean),
  public.bq_my_feedback(uuid), public.bq_feedback_reply(uuid, bigint, text), public.bq_announce(uuid, text) from public, anon, authenticated;
grant execute on function public.bq_relation(uuid, uuid), public.bq_touch(uuid), public.bq_online_players(uuid), public.bq_player_card(uuid, text),
  public.bq_friend_request(uuid, text), public.bq_friend_respond(uuid, text, boolean), public.bq_friend_remove(uuid, text), public.bq_friends(uuid),
  public.bq_notifications_list(uuid), public.bq_notifications_read(uuid, bigint[]), public.bq_set_notifications(uuid, boolean),
  public.bq_my_feedback(uuid), public.bq_feedback_reply(uuid, bigint, text), public.bq_announce(uuid, text) to service_role;
commit;
