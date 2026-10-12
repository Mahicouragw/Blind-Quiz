-- Migration 030: player mute/block/report, admin-reviewed account restrictions, and shareable room-game replays.
-- Additive only. It leaves Migrations 025-029 untouched. All tables and functions are service_role-only.
begin;

create table if not exists public.bq_player_mutes (
  muter_id uuid not null references public.bq_profiles(id) on delete cascade,
  muted_id uuid not null references public.bq_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);
create index if not exists bq_player_mutes_muted_idx on public.bq_player_mutes (muted_id, muter_id);

create table if not exists public.bq_player_blocks (
  blocker_id uuid not null references public.bq_profiles(id) on delete cascade,
  blocked_id uuid not null references public.bq_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists bq_player_blocks_blocked_idx on public.bq_player_blocks (blocked_id, blocker_id);

create table if not exists public.bq_player_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.bq_profiles(id) on delete cascade,
  target_id uuid not null references public.bq_profiles(id) on delete cascade,
  reason text not null check (reason in ('harassment','spam','inappropriate','cheating','other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','reviewed','dismissed','restricted')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.bq_profiles(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  check (reporter_id <> target_id)
);
create index if not exists bq_player_reports_status_idx on public.bq_player_reports (status, created_at desc);
create index if not exists bq_player_reports_target_idx on public.bq_player_reports (target_id, created_at desc);

create table if not exists public.bq_account_restrictions (
  profile_id uuid primary key references public.bq_profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  restricted_by uuid references public.bq_profiles(id) on delete set null,
  restricted_at timestamptz not null default now(),
  source_report_id bigint references public.bq_player_reports(id) on delete set null
);
create index if not exists bq_account_restrictions_at_idx on public.bq_account_restrictions (restricted_at desc);

create table if not exists public.bq_room_game_replay_steps (
  game_id uuid not null references public.bq_room_games(id) on delete cascade,
  step_no integer not null check (step_no between 1 and 500),
  phase text not null check (phase in ('playing','finished')),
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 24000),
  created_at timestamptz not null default now(),
  primary key (game_id, step_no)
);
create index if not exists bq_room_game_replay_steps_at_idx on public.bq_room_game_replay_steps (created_at);

create table if not exists public.bq_room_game_replay_shares (
  share_id uuid primary key default gen_random_uuid(),
  game_id uuid not null unique references public.bq_room_games(id) on delete cascade,
  owner_id uuid not null references public.bq_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  active boolean not null default true
);
create index if not exists bq_room_game_replay_shares_owner_idx on public.bq_room_game_replay_shares (owner_id, created_at desc);

alter table public.bq_player_mutes enable row level security;
alter table public.bq_player_blocks enable row level security;
alter table public.bq_player_reports enable row level security;
alter table public.bq_account_restrictions enable row level security;
alter table public.bq_room_game_replay_steps enable row level security;
alter table public.bq_room_game_replay_shares enable row level security;
revoke all on public.bq_player_mutes, public.bq_player_blocks, public.bq_player_reports, public.bq_account_restrictions,
  public.bq_room_game_replay_steps, public.bq_room_game_replay_shares from public, anon, authenticated;
grant select, insert, update, delete on public.bq_player_mutes, public.bq_player_blocks, public.bq_player_reports, public.bq_account_restrictions,
  public.bq_room_game_replay_steps, public.bq_room_game_replay_shares to service_role;

create or replace function public.bq_player_is_muted(p_me uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_me is not null and p_other is not null and exists (
    select 1 from public.bq_player_mutes where muter_id = p_me and muted_id = p_other);
$$;

create or replace function public.bq_player_is_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.bq_player_blocks where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a));
$$;

-- A player's own mute is one-way; a block hides contact in both directions.
create or replace function public.bq_player_is_hidden(p_me uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.bq_player_is_blocked(p_me, p_other) or public.bq_player_is_muted(p_me, p_other)
    or exists(select 1 from public.bq_account_restrictions where profile_id=p_other);
$$;

create or replace function public.bq_player_mute(p_profile_id uuid, p_name_normalized text, p_muted boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid;
begin
  select id into target from public.bq_profiles where name_normalized = p_name_normalized;
  if target is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if target = p_profile_id then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if p_muted then
    insert into public.bq_player_mutes(muter_id, muted_id) values (p_profile_id, target) on conflict do nothing;
    update public.bq_notifications set read_at = coalesce(read_at, now())
      where profile_id = p_profile_id and actor_id = target and kind = 'message' and read_at is null;
    delete from public.bq_signals where recipient_id = p_profile_id and sender_id = target;
  else
    delete from public.bq_player_mutes where muter_id = p_profile_id and muted_id = target;
  end if;
  return jsonb_build_object('ok', true, 'muted', p_muted);
end; $$;

create or replace function public.bq_player_block(p_profile_id uuid, p_name_normalized text, p_blocked boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid;
begin
  select id into target from public.bq_profiles where name_normalized = p_name_normalized;
  if target is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if target = p_profile_id then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if p_blocked then
    insert into public.bq_player_blocks(blocker_id, blocked_id) values (p_profile_id, target) on conflict do nothing;
    delete from public.bq_friendships where (requester_id = p_profile_id and addressee_id = target) or (requester_id = target and addressee_id = p_profile_id);
    delete from public.bq_notifications where (profile_id = p_profile_id and actor_id = target) or (profile_id = target and actor_id = p_profile_id);
    delete from public.bq_signals where (sender_id = p_profile_id and recipient_id = target) or (sender_id = target and recipient_id = p_profile_id);
  else
    delete from public.bq_player_blocks where blocker_id = p_profile_id and blocked_id = target;
  end if;
  return jsonb_build_object('ok', true, 'blocked', p_blocked, 'relation', 'none');
end; $$;

create or replace function public.bq_player_report(p_profile_id uuid, p_name_normalized text, p_reason text, p_details text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid; new_id bigint; safe_details text;
begin
  select id into target from public.bq_profiles where name_normalized = p_name_normalized;
  if target is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if target = p_profile_id or p_reason not in ('harassment','spam','inappropriate','cheating','other')
    or p_details is not null and char_length(p_details) > 1000 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if exists(select 1 from public.bq_player_reports where reporter_id = p_profile_id and target_id = target and status = 'open') then
    return jsonb_build_object('ok', false, 'code', 'duplicate_report');
  end if;
  safe_details := nullif(btrim(coalesce(p_details, '')), '');
  insert into public.bq_player_reports(reporter_id, target_id, reason, details)
    values (p_profile_id, target, p_reason, safe_details) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;


-- Existing read/write RPCs overridden additively to enforce mute and block semantics.
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
    'relation', case when p.id = p_profile_id then 'self' else public.bq_relation(p_profile_id, p.id) end,
    'isMuted', p.id <> p_profile_id and public.bq_player_is_muted(p_profile_id, p.id),
    'blocked', p.id <> p_profile_id and public.bq_player_is_blocked(p_profile_id, p.id),
    'blockedByMe', p.id <> p_profile_id and exists(select 1 from public.bq_player_blocks where blocker_id=p_profile_id and blocked_id=p.id)));
end; $$;

create or replace function public.bq_online_players(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'level', p.level, 'relation', public.bq_relation(p_profile_id, p.id)) order by p.last_seen_at desc), '[]'::jsonb)
  from (select * from public.bq_profiles where id <> p_profile_id and last_seen_at > now() - interval '2 minutes'
    and not public.bq_player_is_blocked(p_profile_id, id)
    and not exists(select 1 from public.bq_account_restrictions where profile_id=id)
    order by last_seen_at desc limit 100) p;
$$;

create or replace function public.bq_friend_request(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid; rel text;
begin
  select id into target from public.bq_profiles where name_normalized = p_name_normalized;
  if target is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if target = p_profile_id then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if public.bq_player_is_blocked(p_profile_id, target) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=target) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
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
  if public.bq_player_is_blocked(p_profile_id, requester) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=requester) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  update public.bq_notifications set read_at = coalesce(read_at, now()) where profile_id = p_profile_id and kind = 'friend_request' and actor_id = requester;
  if p_accept then
    update public.bq_friendships set status = 'accepted', responded_at = now() where requester_id = requester and addressee_id = p_profile_id;
    insert into public.bq_notifications (profile_id, kind, actor_id) values (requester, 'friend_accepted', p_profile_id);
    return jsonb_build_object('ok', true, 'relation', 'friends');
  end if;
  delete from public.bq_friendships where requester_id = requester and addressee_id = p_profile_id;
  return jsonb_build_object('ok', true, 'relation', 'none');
end; $$;

create or replace function public.bq_notifications_list(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'actor', a.display_name, 'ref', n.ref, 'body', n.body,
      'createdAt', n.created_at, 'read', n.read_at is not null,
      'relation', case when n.kind = 'friend_request' and a.id is not null then public.bq_relation(p_profile_id, a.id) else null end) order by n.created_at desc), '[]'::jsonb)
  from (select * from public.bq_notifications where profile_id = p_profile_id
    and (actor_id is null or (not public.bq_player_is_blocked(p_profile_id, actor_id)
      and not exists(select 1 from public.bq_account_restrictions where profile_id=actor_id)
      and not (kind = 'message' and public.bq_player_is_muted(p_profile_id, actor_id))))
    order by created_at desc limit 60) n
  left join public.bq_profiles a on a.id = n.actor_id;
$$;

create or replace function public.bq_message_keys(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare other uuid;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_player_is_blocked(p_profile_id, other) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=other) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_relation(p_profile_id, other) <> 'friends' then return jsonb_build_object('ok', false, 'code', 'not_friends'); end if;
  return jsonb_build_object('ok', true,
    'theirs', coalesce((select jsonb_agg(jsonb_build_object('deviceId', device_id, 'publicKey', public_key) order by created_at) from public.bq_devices where profile_id = other and revoked_at is null), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('deviceId', device_id, 'publicKey', public_key) order by created_at) from public.bq_devices where profile_id = p_profile_id and revoked_at is null), '[]'::jsonb));
end; $$;

create or replace function public.bq_send_message(p_profile_id uuid, p_name_normalized text, p_sender_device uuid, p_boxes jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; bad integer; for_them integer; new_id bigint;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_player_is_blocked(p_profile_id, other) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=other) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_relation(p_profile_id, other) <> 'friends' then return jsonb_build_object('ok', false, 'code', 'not_friends'); end if;
  if not exists (select 1 from public.bq_devices where device_id = p_sender_device and profile_id = p_profile_id and revoked_at is null) then
    return jsonb_build_object('ok', false, 'code', 'device_unknown');
  end if;
  if p_boxes is null or jsonb_typeof(p_boxes) <> 'object' or octet_length(p_boxes::text) > 24000 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  select count(*) filter (where not (k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(p_boxes -> k) = 'object' and jsonb_typeof(p_boxes -> k -> 'iv') = 'string' and jsonb_typeof(p_boxes -> k -> 'ct') = 'string' and jsonb_typeof(p_boxes -> k -> 's') = 'string'
      and exists (select 1 from public.bq_devices d where d.device_id::text = k and d.profile_id in (p_profile_id, other) and d.revoked_at is null)))
    into bad from jsonb_object_keys(p_boxes) k;
  select count(*) into for_them from public.bq_devices d where d.profile_id = other and d.revoked_at is null and p_boxes ? d.device_id::text;
  if bad > 0 or for_them = 0 then return jsonb_build_object('ok', false, 'code', 'keys_changed'); end if;
  if (select count(*) from public.bq_messages where sender_id = p_profile_id and created_at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  insert into public.bq_messages (sender_id, recipient_id, sender_device_id, boxes) values (p_profile_id, other, p_sender_device, p_boxes) returning id into new_id;
  update public.bq_devices set last_used_at = now() where device_id = p_sender_device;
  -- One unread "message" notification per sender at a time.
  if not public.bq_player_is_muted(other, p_profile_id) and not exists (select 1 from public.bq_notifications where profile_id = other and kind = 'message' and actor_id = p_profile_id and read_at is null) then
    insert into public.bq_notifications (profile_id, kind, actor_id) values (other, 'message', p_profile_id);
  end if;
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

create or replace function public.bq_messages_with(p_profile_id uuid, p_name_normalized text, p_device_id uuid, p_after_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; rows jsonb;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_player_is_blocked(p_profile_id, other) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=other) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint), '[]'::jsonb) into rows from (
    select jsonb_build_object('id', m.id, 'fromMe', m.sender_id = p_profile_id, 'createdAt', m.created_at, 'read', m.read_at is not null,
      'senderDevice', m.sender_device_id, 'senderKey', d.public_key, 'box', m.boxes -> p_device_id::text) as x
    from public.bq_messages m join public.bq_devices d on d.device_id = m.sender_device_id
    where ((m.sender_id = p_profile_id and m.recipient_id = other) or (m.sender_id = other and m.recipient_id = p_profile_id))
      and m.id > coalesce(p_after_id, 0)
      and not (m.sender_id = other and public.bq_player_is_hidden(p_profile_id, other))
    order by m.id desc limit 100) t;
  update public.bq_messages set read_at = now() where recipient_id = p_profile_id and sender_id = other and read_at is null;
  update public.bq_notifications set read_at = now() where profile_id = p_profile_id and kind = 'message' and actor_id = other and read_at is null;
  return jsonb_build_object('ok', true, 'relation', public.bq_relation(p_profile_id, other), 'messages', rows);
end; $$;

create or replace function public.bq_conversations(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'lastAt', c.last_at, 'unread', c.unread,
      'online', coalesce(p.last_seen_at > now() - interval '2 minutes', false)) order by c.last_at desc), '[]'::jsonb)
  from (select case when sender_id = p_profile_id then recipient_id else sender_id end as other, max(created_at) as last_at,
          count(*) filter (where recipient_id = p_profile_id and read_at is null) as unread
        from public.bq_messages where (sender_id = p_profile_id or recipient_id = p_profile_id)
          and not (sender_id <> p_profile_id and public.bq_player_is_hidden(p_profile_id, sender_id))
          and not public.bq_player_is_blocked(p_profile_id, case when sender_id = p_profile_id then recipient_id else sender_id end)
        group by 1 order by 2 desc limit 50) c
  join public.bq_profiles p on p.id = c.other;
$$;

create or replace function public.bq_room_state(p_profile_id uuid,p_room_id uuid,p_after bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.bq_rooms%rowtype;
begin
  if not public.bq_room_can(p_profile_id,p_room_id) then return jsonb_build_object('ok',false,'code','room_unavailable');end if;
  select * into r from public.bq_rooms where id=p_room_id;
  insert into public.bq_room_members(room_id,profile_id) values(p_room_id,p_profile_id)
    on conflict(room_id,profile_id) do update set last_seen_at=now();
  update public.bq_profiles set last_seen_at=now() where id=p_profile_id and (last_seen_at is null or last_seen_at<now()-interval '15 seconds');
  update public.bq_room_games set status='finished',phase='finished',finished_at=now()
    where room_id=p_room_id and status='playing' and created_at<now()-interval '2 hours';
  delete from public.bq_room_voices where created_at<now()-interval '24 hours';
  return jsonb_build_object('ok',true,
    'room',jsonb_build_object('id',r.id,'name',r.name,'isPublic',r.is_public,'mine',r.owner_id=p_profile_id,'isDefault',r.is_default),
    'people',coalesce((select jsonb_agg(jsonb_build_object('name',p.display_name,'level',p.level) order by p.display_name)
      from public.bq_room_members m join public.bq_profiles p on p.id=m.profile_id where m.room_id=p_room_id and m.last_seen_at>now()-interval '2 minutes'),'[]'::jsonb),
    'games',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'kind',g.kind,'title',g.title,'config',g.config,'status',g.status,'phase',g.phase,'maxPlayers',g.max_players,
        'host',(select display_name from public.bq_profiles where id=g.host_id),'hostMe',g.host_id=p_profile_id,'creatorMe',g.creator_id=p_profile_id,
        'synchronized',g.synchronized,'commentsEnabled',g.comments_enabled,'createdAt',g.created_at,
        'commentCount',(select count(*) from public.bq_room_events e where e.game_id=g.id and e.kind='comment'
          and not public.bq_player_is_hidden(p_profile_id,e.profile_id)),
        'recentComments',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'body',e.body,'replyTo',e.reply_to,'replyName',rp.display_name) order by e.id),'[]'::jsonb)
          from (select * from public.bq_room_events where game_id=g.id and kind='comment'
            and not public.bq_player_is_hidden(p_profile_id,profile_id) order by id desc limit 3) e join public.bq_profiles p on p.id=e.profile_id
          left join public.bq_room_events parent on parent.id=e.reply_to left join public.bq_profiles rp on rp.id=parent.profile_id),
        'players',(select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'score',gp.score,'finished',gp.finished,'seat',gp.seat,'ready',gp.ready,'color',gp.color) order by gp.seat),'[]'::jsonb)
          from public.bq_room_game_players gp join public.bq_profiles p on p.id=gp.profile_id where gp.game_id=g.id)) order by g.created_at desc)
      from (select * from public.bq_room_games where room_id=p_room_id and (status='playing' or finished_at>now()-interval '15 minutes') order by created_at desc limit 20) g),'[]'::jsonb),
    'voices',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',p.display_name,'durationMs',v.duration_ms,'createdAt',v.created_at) order by v.id)
      from (select * from public.bq_room_voices where room_id=p_room_id and created_at>now()-interval '24 hours' order by id desc limit 30) v
      join public.bq_profiles p on p.id=v.profile_id
      where not public.bq_player_is_hidden(p_profile_id,v.profile_id)),'[]'::jsonb),
    'chat',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'body',e.body,'createdAt',e.created_at) order by e.id)
      from (select * from public.bq_room_events where room_id=p_room_id and kind='chat' and id>coalesce(p_after,0)
        and not public.bq_player_is_hidden(p_profile_id,profile_id) order by id desc limit 50) e
      join public.bq_profiles p on p.id=e.profile_id),'[]'::jsonb));
end; $$;

create or replace function public.bq_room_voice_get(p_profile_id uuid, p_voice_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.bq_room_voices%rowtype;
begin
  select * into v from public.bq_room_voices where id = p_voice_id and created_at > now() - interval '24 hours';
  if not found or not public.bq_room_can(p_profile_id, v.room_id) or public.bq_player_is_hidden(p_profile_id, v.profile_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  return jsonb_build_object('ok', true, 'id', v.id, 'audio', v.audio, 'durationMs', v.duration_ms);
end; $$;

create or replace function public.bq_signal_send(p_profile_id uuid, p_name_normalized text, p_sender_device uuid, p_session uuid, p_kind text, p_boxes jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; bad integer; for_them integer; new_id bigint;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_player_is_blocked(p_profile_id, other) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=other) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_relation(p_profile_id, other) <> 'friends' then return jsonb_build_object('ok', false, 'code', 'not_friends'); end if;
  if not exists (select 1 from public.bq_devices where device_id = p_sender_device and profile_id = p_profile_id and revoked_at is null) then
    return jsonb_build_object('ok', false, 'code', 'device_unknown');
  end if;
  if p_session is null or p_kind not in ('ring', 'signal') or p_boxes is null or jsonb_typeof(p_boxes) <> 'object' or octet_length(p_boxes::text) > 24000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if p_kind = 'ring' and not exists (select 1 from public.bq_profiles where id = other and last_seen_at > now() - interval '2 minutes') then
    return jsonb_build_object('ok', false, 'code', 'player_offline');
  end if;
  select count(*) filter (where not (k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(p_boxes -> k) = 'object' and jsonb_typeof(p_boxes -> k -> 'iv') = 'string' and jsonb_typeof(p_boxes -> k -> 'ct') = 'string' and jsonb_typeof(p_boxes -> k -> 's') = 'string'
      and exists (select 1 from public.bq_devices d where d.device_id::text = k and d.profile_id = other and d.revoked_at is null)))
    into bad from jsonb_object_keys(p_boxes) k;
  select count(*) into for_them from public.bq_devices d where d.profile_id = other and d.revoked_at is null and p_boxes ? d.device_id::text;
  if bad > 0 or for_them = 0 then return jsonb_build_object('ok', false, 'code', 'keys_changed'); end if;
  if public.bq_player_is_muted(other, p_profile_id) then return jsonb_build_object('ok', true); end if;
  if (select count(*) from public.bq_signals where sender_id = p_profile_id and created_at > now() - interval '10 minutes') >= 400 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  delete from public.bq_signals where created_at < now() - interval '10 minutes';
  insert into public.bq_signals (sender_id, recipient_id, sender_device_id, session_id, kind, boxes) values (p_profile_id, other, p_sender_device, p_session, p_kind, p_boxes) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

create or replace function public.bq_signals_poll(p_profile_id uuid, p_device_id uuid, p_after bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.bq_devices where device_id = p_device_id and profile_id = p_profile_id and revoked_at is null) then
    return jsonb_build_object('ok', false, 'code', 'device_unknown');
  end if;
  return jsonb_build_object('ok', true, 'signals', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'from', p.display_name, 'session', s.session_id, 'kind', s.kind,
      'senderDevice', s.sender_device_id, 'senderKey', d.public_key, 'box', s.boxes -> p_device_id::text) order by s.id)
    from public.bq_signals s join public.bq_profiles p on p.id = s.sender_id join public.bq_devices d on d.device_id = s.sender_device_id and d.profile_id = s.sender_id
    where s.recipient_id = p_profile_id and s.id > coalesce(p_after, 0) and s.created_at > now() - interval '3 minutes'
      and s.boxes ? p_device_id::text and not public.bq_player_is_hidden(p_profile_id, s.sender_id)), '[]'::jsonb));
end; $$;

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
          and (n.actor_id is null or (not public.bq_player_is_blocked(who, n.actor_id)
            and not exists(select 1 from public.bq_account_restrictions where profile_id=n.actor_id)
            and not (n.kind = 'message' and public.bq_player_is_muted(who, n.actor_id))))
        order by n.id desc limit 10) t), '[]'::jsonb) else '[]'::jsonb end);
end; $$;

create or replace function public.bq_game_watch(p_profile_id uuid,p_game_id uuid,p_after bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype;public_state jsonb;idx integer;total integer;solved timestamptz;started timestamptz;winner_seat integer;next_seat integer;revealed jsonb;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or not public.bq_room_can(p_profile_id,g.room_id) then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.kind='quiz' and g.phase='playing' then
    idx:=coalesce((g.state->>'currentIndex')::integer,0);total:=jsonb_array_length(g.state->'questionIds');solved:=nullif(g.state->>'solvedAt','')::timestamptz;started:=nullif(g.state->>'questionStartedAt','')::timestamptz;
    if idx<total and ((solved is not null and solved<now()-interval '3 seconds') or (started is not null and started<now()-case when g.config->>'mode'='quickdecision' then interval '5 seconds' when g.config->>'mode'='rapid' then interval '15 seconds' when g.config->>'mode'='timeattack' then interval '10 seconds' else interval '30 seconds' end)) then
      idx:=idx+1;g.state:=jsonb_set(g.state,'{currentIndex}',to_jsonb(idx),true);g.state:=jsonb_set(g.state,'{solvedAt}','null'::jsonb,true);g.state:=jsonb_set(g.state,'{questionStartedAt}',to_jsonb(now()),true);
      update public.bq_room_games set state=g.state,phase=case when idx>=total then 'finished' else 'playing' end,status=case when idx>=total then 'finished' else 'playing' end,finished_at=case when idx>=total then now() else null end where id=p_game_id;
      if idx>=total then update public.bq_room_game_players set finished=true where game_id=p_game_id;g.phase:='finished';g.status:='finished';end if;
    end if;
  elsif g.kind='letters' and g.phase='playing' and nullif(g.state->>'endsAt','')::timestamptz<=now() then
    select seat into winner_seat from public.bq_room_game_players where game_id=p_game_id order by score desc,seat limit 1;
    g.state:=jsonb_set(g.state,'{winner}',to_jsonb(coalesce(winner_seat,0)),true);g.state:=jsonb_set(g.state,'{finished}','true'::jsonb,true);
    update public.bq_room_games set state=g.state,phase='finished',status='finished',finished_at=now() where id=p_game_id;
    update public.bq_room_game_players set finished=true where game_id=p_game_id;g.phase:='finished';g.status:='finished';
  elsif g.kind='soundmatch' and g.phase='playing' and nullif(g.state->>'resolveAt','')::timestamptz<=now() then
    if g.state->>'lastMatched'='false' then next_seat:=((g.state->>'turnSeat')::integer%g.max_players)+1;g.state:=jsonb_set(g.state,'{turnSeat}',to_jsonb(next_seat),true);end if;
    g.state:=jsonb_set(g.state,'{visiblePair}','[]'::jsonb,true);g.state:=jsonb_set(g.state,'{lastMatched}','null'::jsonb,true);g.state:=jsonb_set(g.state,'{resolveAt}','null'::jsonb,true);
    update public.bq_room_games set state=g.state where id=p_game_id;
  end if;
  public_state:=g.state-'answerKeys'-'attempts'-'deck'-'cards';
  if g.kind='blackjack' and g.phase='playing' and jsonb_typeof(g.state->'dealer')='array' and jsonb_array_length(g.state->'dealer')>1 then public_state:=jsonb_set(public_state,'{dealer}',jsonb_build_array(g.state->'dealer'->0,to_jsonb('hidden'::text)),true);end if;
  if g.kind='soundmatch' then
    select coalesce(jsonb_object_agg(x.value->>'number',x.value->>'name'),'{}'::jsonb) into revealed from jsonb_array_elements(g.state->'cards') x(value)
      where g.state->'matched' @> jsonb_build_array((x.value->>'number')::integer);
    public_state:=public_state||jsonb_build_object('cardCount',jsonb_array_length(g.state->'cards'),'revealedNames',coalesce(revealed,'{}'::jsonb));
  end if;
  return jsonb_build_object('ok',true,'status',g.status,'phase',g.phase,'kind',g.kind,'title',g.title,'config',g.config,'roomId',g.room_id,'maxPlayers',g.max_players,'synchronized',g.synchronized,'commentsEnabled',g.comments_enabled,
    'roomMembers',(select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'level',p.level) order by p.display_name),'[]'::jsonb) from public.bq_room_members m join public.bq_profiles p on p.id=m.profile_id where m.room_id=g.room_id and m.last_seen_at>now()-interval '2 minutes'),
    'host',(select display_name from public.bq_profiles where id=g.host_id),'hostMe',g.host_id=p_profile_id,'creatorMe',g.creator_id=p_profile_id,
    'seat',(select seat from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'score',gp.score,'finished',gp.finished,'seat',gp.seat,'ready',gp.ready,'color',gp.color) order by gp.seat),'[]'::jsonb) from public.bq_room_game_players gp join public.bq_profiles p on p.id=gp.profile_id where gp.game_id=p_game_id),
    'state',public_state,'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'kind',e.kind,'body',e.body,'replyTo',e.reply_to,'replyName',rp.display_name) order by e.id)
      from (select * from public.bq_room_events where game_id=p_game_id and id>coalesce(p_after,0)
        and not (kind in ('say','comment','chat') and public.bq_player_is_hidden(p_profile_id,profile_id))
        order by id limit 120) e join public.bq_profiles p on p.id=e.profile_id left join public.bq_room_events parent on parent.id=e.reply_to left join public.bq_profiles rp on rp.id=parent.profile_id),'[]'::jsonb));
end; $$;

create or replace function public.bq_game_invite(p_profile_id uuid, p_game_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid; g public.bq_room_games%rowtype; sender_name text;
begin
  select * into g from public.bq_room_games where id=p_game_id;
  if not found or g.phase<>'lobby' or g.status<>'playing' or not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id) then
    return jsonb_build_object('ok',false,'code','game_unavailable');
  end if;
  select id into target from public.bq_profiles where name_normalized=p_name_normalized;
  if target is null then return jsonb_build_object('ok',false,'code','player_unavailable');end if;
  if target=p_profile_id then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if public.bq_player_is_blocked(p_profile_id,target) then return jsonb_build_object('ok',false,'code','player_blocked');end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=target) then return jsonb_build_object('ok',false,'code','player_unavailable');end if;
  if public.bq_relation(p_profile_id,target)<>'friends' and not exists(
    select 1 from public.bq_room_members where room_id=g.room_id and profile_id=target and last_seen_at>now()-interval '2 minutes'
  ) then return jsonb_build_object('ok',false,'code','not_room_member');end if;
  if exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=target) then return jsonb_build_object('ok',false,'code','already_joined');end if;
  if (select count(*) from public.bq_room_game_players where game_id=p_game_id)>=g.max_players then return jsonb_build_object('ok',false,'code','game_full');end if;
  select display_name into sender_name from public.bq_profiles where id=p_profile_id;
  insert into public.bq_notifications(profile_id,kind,actor_id,ref,body)
    values(target,'game_invite',p_profile_id,p_game_id::text,'game-invite|'||g.room_id::text||'|'||g.title);
  return jsonb_build_object('ok',true,'to',target,'from',sender_name);
end; $$;

-- Admin-only inbox. Reports are retained until the reporter's profile is deleted. No report automatically restricts an account.
create or replace function public.bq_admin_player_reports(p_admin_id uuid, p_status text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from public.bq_admins where profile_id = p_admin_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_status not in ('open','reviewed','dismissed','restricted','all') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'reporter', reporter.display_name, 'target', target.display_name,
      'reason', r.reason, 'details', r.details, 'status', r.status,
      'createdAt', r.created_at, 'reviewedAt', r.reviewed_at, 'reviewNote', r.review_note,
      'restricted', restriction.profile_id is not null, 'restrictedAt', restriction.restricted_at
    ) order by case r.status when 'open' then 0 when 'reviewed' then 1 when 'restricted' then 2 else 3 end, r.created_at desc)
    from (select * from public.bq_player_reports where p_status = 'all' or status = p_status order by created_at desc limit 250) r
    join public.bq_profiles reporter on reporter.id = r.reporter_id
    join public.bq_profiles target on target.id = r.target_id
    left join public.bq_account_restrictions restriction on restriction.profile_id = r.target_id
  ), '[]'::jsonb));
end; $$;

create or replace function public.bq_admin_player_report_action(p_admin_id uuid, p_report_id bigint, p_action text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare report public.bq_player_reports%rowtype; safe_note text; is_restricted boolean;
begin
  if not exists(select 1 from public.bq_admins where profile_id = p_admin_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_action not in ('review','dismiss','restrict','restore') or p_report_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  select * into report from public.bq_player_reports where id = p_report_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'report_unavailable'); end if;
  safe_note := nullif(btrim(coalesce(p_note, '')), '');
  if safe_note is not null then safe_note := left(safe_note, 500); end if;

  if p_action = 'restrict' then
    insert into public.bq_account_restrictions(profile_id, reason, restricted_by, source_report_id)
      values(report.target_id, left(coalesce(safe_note, 'Admin review: ' || report.reason), 500), p_admin_id, report.id)
      on conflict(profile_id) do update set reason=excluded.reason, restricted_by=excluded.restricted_by,
        restricted_at=now(), source_report_id=excluded.source_report_id;
    delete from public.bq_notify_tokens where profile_id = report.target_id;
    delete from public.bq_signals where sender_id = report.target_id or recipient_id = report.target_id;
    update public.bq_sessions set revoked_at=now() where profile_id=report.target_id and revoked_at is null;
    update public.bq_player_reports set status='restricted', reviewed_at=now(), reviewed_by=p_admin_id, review_note=safe_note where id=report.id;
  elsif p_action = 'restore' then
    delete from public.bq_account_restrictions where profile_id=report.target_id;
    update public.bq_player_reports set status='reviewed', reviewed_at=now(), reviewed_by=p_admin_id, review_note=safe_note where id=report.id;
  elsif p_action = 'dismiss' then
    update public.bq_player_reports set status='dismissed', reviewed_at=now(), reviewed_by=p_admin_id, review_note=safe_note where id=report.id;
  else
    update public.bq_player_reports set status='reviewed', reviewed_at=now(), reviewed_by=p_admin_id, review_note=safe_note where id=report.id;
  end if;
  select exists(select 1 from public.bq_account_restrictions where profile_id=report.target_id) into is_restricted;
  return jsonb_build_object('ok', true, 'id', report.id, 'status', case when p_action='restore' or p_action='review' then 'reviewed' else p_action || 'ed' end,
    'restricted', is_restricted);
end; $$;

-- A capped, rolling snapshot history is captured only for synchronized room games. Private chats are never recorded.
create or replace function public.bq_room_game_replay_capture_step()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare next_step integer;
begin
  if new.state is not distinct from old.state and new.phase is not distinct from old.phase then return new; end if;
  if not coalesce(new.synchronized, false) or new.phase not in ('playing','finished')
     or new.state is null or jsonb_typeof(new.state) <> 'object' or octet_length(new.state::text) > 24000 then return new; end if;
  delete from public.bq_room_game_replay_steps where created_at < now() - interval '90 days';
  delete from public.bq_room_game_replay_shares where expires_at <= now();
  select coalesce(max(step_no), 0) + 1 into next_step from public.bq_room_game_replay_steps where game_id = new.id;
  if next_step <= 500 then
    insert into public.bq_room_game_replay_steps(game_id, step_no, phase, state)
      values(new.id, next_step, new.phase, new.state);
  else
    update public.bq_room_game_replay_steps set phase=new.phase, state=new.state, created_at=now()
      where game_id=new.id and step_no=500;
  end if;
  return new;
end; $$;

create or replace trigger bq_room_game_replay_capture
  after update of state, phase on public.bq_room_games
  for each row execute function public.bq_room_game_replay_capture_step();

-- Recursive allowlist-by-exclusion sanitizer. It strips answer keys, private attempts, decks/cards, and identity/session fields.
create or replace function public.bq_replay_public_jsonb(p_value jsonb)
returns jsonb language plpgsql immutable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    select coalesce(jsonb_object_agg(key, public.bq_replay_public_jsonb(value)), '{}'::jsonb) into result
      from jsonb_each(p_value)
      where lower(key) not in ('answerkeys','answerkey','answer_keys','answer_key','correctanswer','correct_answer','attempts','attemptsbyquestion','deck','cards','soundslots','sound_slots','soundslot','sound_slot','profileid','profile_id','userid','user_id','deviceid','device_id','session','token','secret','salt','privatekey','private_key','password','auth','authorization');
    return result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.bq_replay_public_jsonb(value) order by ordinal), '[]'::jsonb) into result
      from jsonb_array_elements(p_value) with ordinality as item(value, ordinal);
    return result;
  end if;
  return p_value;
end; $$;

-- Sound Match exposes only cards already revealed by a match; never the shuffled hidden card layout.
create or replace function public.bq_replay_public_state(p_kind text, p_state jsonb, p_phase text)
returns jsonb language plpgsql immutable security definer set search_path = public, pg_temp as $$
declare result jsonb; revealed jsonb;
begin
  result := public.bq_replay_public_jsonb(p_state);
  if p_kind = 'blackjack' and p_phase <> 'finished' and jsonb_typeof(p_state->'dealer') = 'array' and jsonb_array_length(p_state->'dealer') > 1 then
    result := jsonb_set(result, '{dealer}', jsonb_build_array(p_state->'dealer'->0, to_jsonb('hidden'::text)), true);
  end if;
  if p_kind = 'soundmatch' and jsonb_typeof(p_state->'cards') = 'array' then
    select coalesce(jsonb_object_agg(card.value->>'number', card.value->>'name'), '{}'::jsonb) into revealed
      from jsonb_array_elements(p_state->'cards') as card(value)
      where coalesce(p_state->'matched', '[]'::jsonb) @> jsonb_build_array((card.value->>'number')::integer);
    result := (result - 'cardCount' - 'revealedNames') || jsonb_build_object(
      'cardCount', jsonb_array_length(p_state->'cards'), 'revealedNames', coalesce(revealed, '{}'::jsonb));
  end if;
  return result;
end; $$;

-- Convert internal profile-keyed quiz attempt maps into seat-keyed correctness only; answer text and UUIDs stay private.
create or replace function public.bq_replay_attempts_by_seat(p_attempts jsonb, p_game_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('questionIndex', question.key::integer, 'responses', coalesce((
    select jsonb_object_agg(player.seat::text, question.value->player.profile_id::text)
      from public.bq_room_game_players player
      where player.game_id=p_game_id and question.value ? player.profile_id::text
  ), '{}'::jsonb)) order by question.key::integer), '[]'::jsonb)
  from jsonb_each(coalesce(p_attempts, '{}'::jsonb)) as question(key, value)
  where question.key ~ '^[0-9]+$' and jsonb_typeof(question.value)='object';
$$;

create or replace function public.bq_room_game_replay_create(p_profile_id uuid, p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare game public.bq_room_games%rowtype; shared public.bq_room_game_replay_shares%rowtype;
begin
  delete from public.bq_room_game_replay_steps where created_at < now() - interval '90 days';
  delete from public.bq_room_game_replay_shares where expires_at <= now();
  select * into game from public.bq_room_games where id=p_game_id;
  if not found or not game.synchronized or game.phase <> 'finished' or game.status <> 'finished'
    or not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id)
    or not exists(select 1 from public.bq_room_game_replay_steps where game_id=p_game_id) then
    return jsonb_build_object('ok', false, 'code', 'replay_unavailable');
  end if;
  insert into public.bq_room_game_replay_shares(game_id, owner_id, expires_at, active)
    values(p_game_id, p_profile_id, now()+interval '90 days', true)
    on conflict(game_id) do update set owner_id=excluded.owner_id, expires_at=excluded.expires_at, active=true
    returning * into shared;
  return jsonb_build_object('ok', true, 'shareId', shared.share_id, 'expiresAt', shared.expires_at);
end; $$;

-- Public-link read: the API exposes this RPC without a player session only after a high-entropy share id is supplied.
create or replace function public.bq_room_game_replay_read(p_share_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare shared public.bq_room_game_replay_shares%rowtype; game public.bq_room_games%rowtype;
begin
  delete from public.bq_room_game_replay_steps where created_at < now() - interval '90 days';
  delete from public.bq_room_game_replay_shares where expires_at <= now();
  select * into shared from public.bq_room_game_replay_shares where share_id=p_share_id and active and expires_at>now();
  if not found then return jsonb_build_object('ok', false, 'code', 'replay_unavailable'); end if;
  select * into game from public.bq_room_games where id=shared.game_id;
  if not found or game.phase<>'finished' or game.status<>'finished' then return jsonb_build_object('ok', false, 'code', 'replay_unavailable'); end if;
  return jsonb_build_object('ok', true,
    'shareId', shared.share_id, 'createdAt', shared.created_at, 'expiresAt', shared.expires_at,
    'game', jsonb_build_object('kind',game.kind,'title',game.title,'phase',game.phase,'status',game.status,'finishedAt',game.finished_at,
      'config',jsonb_strip_nulls(jsonb_build_object('mode',game.config->>'mode','category',game.config->>'category','level',game.config->>'level')),
      'players',coalesce((select jsonb_agg(jsonb_build_object('name',profile.display_name,'seat',player.seat,'score',player.score,'finished',player.finished,'color',player.color) order by player.seat)
        from public.bq_room_game_players player join public.bq_profiles profile on profile.id=player.profile_id where player.game_id=game.id),'[]'::jsonb)),
    'steps',coalesce((select jsonb_agg(jsonb_build_object('step',step.step_no,'phase',step.phase,'createdAt',step.created_at,
        'state',public.bq_replay_public_state(game.kind,step.state,step.phase),
        'attemptsByQuestion',public.bq_replay_attempts_by_seat(step.state->'attempts',game.id)) order by step.step_no)
      from public.bq_room_game_replay_steps step where step.game_id=game.id),'[]'::jsonb));
end; $$;

revoke all on function public.bq_player_is_muted(uuid, uuid), public.bq_player_is_blocked(uuid, uuid), public.bq_player_is_hidden(uuid, uuid),
  public.bq_player_mute(uuid, text, boolean), public.bq_player_block(uuid, text, boolean), public.bq_player_report(uuid, text, text, text),
  public.bq_player_card(uuid, text), public.bq_online_players(uuid), public.bq_friend_request(uuid, text), public.bq_friend_respond(uuid, text, boolean),
  public.bq_notifications_list(uuid), public.bq_message_keys(uuid, text), public.bq_send_message(uuid, text, uuid, jsonb), public.bq_messages_with(uuid, text, uuid, bigint),
  public.bq_conversations(uuid), public.bq_room_state(uuid, uuid, bigint), public.bq_room_voice_get(uuid, bigint),
  public.bq_signal_send(uuid, text, uuid, uuid, text, jsonb), public.bq_signals_poll(uuid, uuid, bigint), public.bq_notify_check(text, bigint, boolean),
  public.bq_game_watch(uuid, uuid, bigint), public.bq_game_invite(uuid, uuid, text), public.bq_admin_player_reports(uuid, text),
  public.bq_admin_player_report_action(uuid, bigint, text, text), public.bq_room_game_replay_capture_step(), public.bq_replay_public_jsonb(jsonb),
  public.bq_replay_public_state(text, jsonb, text), public.bq_replay_attempts_by_seat(jsonb, uuid), public.bq_room_game_replay_create(uuid, uuid),
  public.bq_room_game_replay_read(uuid) from public, anon, authenticated;
grant execute on function public.bq_player_is_muted(uuid, uuid), public.bq_player_is_blocked(uuid, uuid), public.bq_player_is_hidden(uuid, uuid),
  public.bq_player_mute(uuid, text, boolean), public.bq_player_block(uuid, text, boolean), public.bq_player_report(uuid, text, text, text),
  public.bq_player_card(uuid, text), public.bq_online_players(uuid), public.bq_friend_request(uuid, text), public.bq_friend_respond(uuid, text, boolean),
  public.bq_notifications_list(uuid), public.bq_message_keys(uuid, text), public.bq_send_message(uuid, text, uuid, jsonb), public.bq_messages_with(uuid, text, uuid, bigint),
  public.bq_conversations(uuid), public.bq_room_state(uuid, uuid, bigint), public.bq_room_voice_get(uuid, bigint),
  public.bq_signal_send(uuid, text, uuid, uuid, text, jsonb), public.bq_signals_poll(uuid, uuid, bigint), public.bq_notify_check(text, bigint, boolean),
  public.bq_game_watch(uuid, uuid, bigint), public.bq_game_invite(uuid, uuid, text), public.bq_admin_player_reports(uuid, text),
  public.bq_admin_player_report_action(uuid, bigint, text, text), public.bq_room_game_replay_capture_step(), public.bq_replay_public_jsonb(jsonb),
  public.bq_replay_public_state(text, jsonb, text), public.bq_replay_attempts_by_seat(jsonb, uuid), public.bq_room_game_replay_create(uuid, uuid),
  public.bq_room_game_replay_read(uuid) to service_role;


-- Explicit block/restriction checks for direct room and match invitations.
create or replace function public.bq_room_invite(p_profile_id uuid, p_room_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid;
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_player_is_blocked(p_profile_id, other) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=other) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_relation(p_profile_id, other) <> 'friends' then return jsonb_build_object('ok', false, 'code', 'not_friends'); end if;
  insert into public.bq_room_access (room_id, profile_id) values (p_room_id, other) on conflict do nothing;
  insert into public.bq_notifications (profile_id, kind, actor_id, ref, body)
    values (other, 'room_invite', p_profile_id, p_room_id::text, (select name from public.bq_rooms where id = p_room_id));
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.bq_match_invite(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; room uuid; me_name text; other_name text;
begin
  select id, display_name into other, other_name from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_player_is_blocked(p_profile_id, other) then return jsonb_build_object('ok', false, 'code', 'player_blocked'); end if;
  if exists(select 1 from public.bq_account_restrictions where profile_id=other) then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_relation(p_profile_id, other) <> 'friends' then return jsonb_build_object('ok', false, 'code', 'not_friends'); end if;
  select display_name into me_name from public.bq_profiles where id = p_profile_id;
  select r.id into room from public.bq_rooms r
    where not r.is_public and r.owner_id in (p_profile_id, other)
      and exists (select 1 from public.bq_room_access a where a.room_id = r.id and a.profile_id = p_profile_id)
      and exists (select 1 from public.bq_room_access a where a.room_id = r.id and a.profile_id = other)
      and (select count(*) from public.bq_room_access a where a.room_id = r.id) = 2
    order by r.created_at limit 1;
  if room is null then
    insert into public.bq_rooms (name, is_public, owner_id) values (left('Match: ' || me_name || ' and ' || other_name, 40), false, p_profile_id) returning id into room;
    insert into public.bq_room_access (room_id, profile_id) values (room, p_profile_id), (room, other) on conflict do nothing;
  end if;
  insert into public.bq_notifications (profile_id, kind, actor_id, ref, body) values (other, 'game_invite', p_profile_id, room::text, '');
  return jsonb_build_object('ok', true, 'roomId', room);
end; $$;

commit;
