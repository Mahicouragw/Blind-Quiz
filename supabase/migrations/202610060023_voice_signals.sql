-- Migration 023: room voice messages (deleted after 24 hours) and sealed signals between friends for direct
-- phone-to-phone file transfer and calls (owner decisions, 6 Oct 2026).
-- Signals carry only end-to-end sealed boxes (the same per-device AES-GCM boxes as Migration 020), so the server
-- cannot read or forge call or transfer setup. Files and call audio/video never touch the server: they go directly
-- between the two devices, which is why both friends must be online. Signals are kept for 10 minutes at most.
-- Additive: two new tables, new functions; bq_touch and bq_room_state are replaced with the same signatures.
-- Requires migrations 001-022. Applied only by .github/workflows/apply-migration-023.yml.
begin;
create table if not exists public.bq_room_voices (
  id bigserial primary key,
  room_id uuid not null references public.bq_rooms(id) on delete cascade,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  audio text not null check (char_length(audio) <= 400000 and audio like 'data:audio/%'),
  duration_ms integer not null check (duration_ms between 300 and 60000),
  created_at timestamptz not null default now()
);
create index if not exists bq_room_voices_room_idx on public.bq_room_voices (room_id, id desc);
create index if not exists bq_room_voices_created_idx on public.bq_room_voices (created_at);
alter table public.bq_room_voices enable row level security;

create table if not exists public.bq_signals (
  id bigserial primary key,
  sender_id uuid not null references public.bq_profiles(id) on delete cascade,
  recipient_id uuid not null references public.bq_profiles(id) on delete cascade,
  sender_device_id uuid not null,
  session_id uuid not null,
  kind text not null check (kind in ('ring', 'signal')),
  boxes jsonb not null check (jsonb_typeof(boxes) = 'object' and octet_length(boxes::text) <= 24000),
  created_at timestamptz not null default now()
);
create index if not exists bq_signals_recipient_idx on public.bq_signals (recipient_id, id);
create index if not exists bq_signals_created_idx on public.bq_signals (created_at);
alter table public.bq_signals enable row level security;

-- Heartbeat: as before, plus how many call or file requests are waiting for this player (from the last minute).
create or replace function public.bq_touch(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.bq_profiles set last_seen_at = now() where id = p_profile_id and (last_seen_at is null or last_seen_at < now() - interval '15 seconds');
  return jsonb_build_object('unread', (select count(*) from public.bq_notifications where profile_id = p_profile_id and read_at is null),
    'notificationsEnabled', (select notifications_enabled from public.bq_profiles where id = p_profile_id),
    'ring', (select count(*) from public.bq_signals where recipient_id = p_profile_id and kind = 'ring' and created_at > now() - interval '60 seconds'));
end; $$;

create or replace function public.bq_room_state(p_profile_id uuid, p_room_id uuid, p_after bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.bq_rooms%rowtype;
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  select * into r from public.bq_rooms where id = p_room_id;
  insert into public.bq_room_members (room_id, profile_id) values (p_room_id, p_profile_id)
    on conflict (room_id, profile_id) do update set last_seen_at = now();
  update public.bq_profiles set last_seen_at = now() where id = p_profile_id and (last_seen_at is null or last_seen_at < now() - interval '15 seconds');
  update public.bq_room_games set status = 'finished', finished_at = now() where room_id = p_room_id and status = 'playing' and created_at < now() - interval '2 hours';
  delete from public.bq_room_voices where created_at < now() - interval '24 hours';
  return jsonb_build_object('ok', true, 'room', jsonb_build_object('id', r.id, 'name', r.name, 'isPublic', r.is_public, 'mine', r.owner_id = p_profile_id, 'isDefault', r.is_default),
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'level', p.level) order by p.display_name)
      from public.bq_room_members m join public.bq_profiles p on p.id = m.profile_id where m.room_id = p_room_id and m.last_seen_at > now() - interval '2 minutes'), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'config', g.config, 'status', g.status,
        'host', (select display_name from public.bq_profiles where id = g.host_id), 'createdAt', g.created_at,
        'players', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'score', gp.score, 'finished', gp.finished) order by gp.score desc), '[]'::jsonb)
          from public.bq_room_game_players gp join public.bq_profiles p on p.id = gp.profile_id where gp.game_id = g.id)) order by g.created_at desc)
      from (select * from public.bq_room_games where room_id = p_room_id and (status = 'playing' or finished_at > now() - interval '15 minutes') order by created_at desc limit 20) g), '[]'::jsonb),
    'voices', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', p.display_name, 'durationMs', v.duration_ms, 'createdAt', v.created_at) order by v.id)
      from (select * from public.bq_room_voices where room_id = p_room_id and created_at > now() - interval '24 hours' order by id desc limit 30) v
      join public.bq_profiles p on p.id = v.profile_id), '[]'::jsonb),
    'chat', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', p.display_name, 'body', e.body, 'createdAt', e.created_at) order by e.id)
      from (select * from public.bq_room_events where room_id = p_room_id and kind = 'chat' and id > coalesce(p_after, 0) order by id desc limit 50) e
      join public.bq_profiles p on p.id = e.profile_id), '[]'::jsonb));
end; $$;

-- A voice message in a room (recorded on the phone, at most 60 seconds). Removed after 24 hours.
create or replace function public.bq_room_voice_send(p_profile_id uuid, p_room_id uuid, p_audio text, p_duration_ms integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id bigint;
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  if p_audio is null or char_length(p_audio) > 400000 or p_audio !~ '^data:audio/(webm|ogg|mp4|mpeg|aac|wav)(;codecs=[a-z0-9.]+)?;base64,[A-Za-z0-9+/]+=*$'
    or p_duration_ms is null or p_duration_ms < 300 or p_duration_ms > 60000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if (select count(*) from public.bq_room_voices where profile_id = p_profile_id and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  delete from public.bq_room_voices where created_at < now() - interval '24 hours';
  insert into public.bq_room_voices (room_id, profile_id, audio, duration_ms) values (p_room_id, p_profile_id, p_audio, p_duration_ms) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

create or replace function public.bq_room_voice_get(p_profile_id uuid, p_voice_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.bq_room_voices%rowtype;
begin
  select * into v from public.bq_room_voices where id = p_voice_id and created_at > now() - interval '24 hours';
  if not found or not public.bq_room_can(p_profile_id, v.room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  return jsonb_build_object('ok', true, 'id', v.id, 'audio', v.audio, 'durationMs', v.duration_ms);
end; $$;

-- A sealed signal to a friend. 'ring' starts a call or a file transfer and needs the friend online now;
-- 'signal' carries the connection setup for a session that was already started.
create or replace function public.bq_signal_send(p_profile_id uuid, p_name_normalized text, p_sender_device uuid, p_session uuid, p_kind text, p_boxes jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; bad integer; for_them integer; new_id bigint;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
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
  if (select count(*) from public.bq_signals where sender_id = p_profile_id and created_at > now() - interval '10 minutes') >= 400 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  delete from public.bq_signals where created_at < now() - interval '10 minutes';
  insert into public.bq_signals (sender_id, recipient_id, sender_device_id, session_id, kind, boxes) values (p_profile_id, other, p_sender_device, p_session, p_kind, p_boxes) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

-- Signals for this device after p_after (last 3 minutes), with the sender device's public key for verification.
create or replace function public.bq_signals_poll(p_profile_id uuid, p_device_id uuid, p_after bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.bq_devices where device_id = p_device_id and profile_id = p_profile_id and revoked_at is null) then
    return jsonb_build_object('ok', false, 'code', 'device_unknown');
  end if;
  return jsonb_build_object('ok', true, 'signals', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'from', p.display_name, 'session', s.session_id, 'kind', s.kind,
      'senderDevice', s.sender_device_id, 'senderKey', d.public_key, 'box', s.boxes -> p_device_id::text) order by s.id)
    from public.bq_signals s join public.bq_profiles p on p.id = s.sender_id join public.bq_devices d on d.device_id = s.sender_device_id and d.profile_id = s.sender_id
    where s.recipient_id = p_profile_id and s.id > coalesce(p_after, 0) and s.created_at > now() - interval '3 minutes' and s.boxes ? p_device_id::text), '[]'::jsonb));
end; $$;

revoke all on function public.bq_touch(uuid), public.bq_room_state(uuid, uuid, bigint), public.bq_room_voice_send(uuid, uuid, text, integer), public.bq_room_voice_get(uuid, bigint),
  public.bq_signal_send(uuid, text, uuid, uuid, text, jsonb), public.bq_signals_poll(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.bq_touch(uuid), public.bq_room_state(uuid, uuid, bigint), public.bq_room_voice_send(uuid, uuid, text, integer), public.bq_room_voice_get(uuid, bigint),
  public.bq_signal_send(uuid, text, uuid, uuid, text, jsonb), public.bq_signals_poll(uuid, uuid, bigint) to service_role;
commit;
