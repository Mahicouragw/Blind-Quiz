-- Migration 020: end-to-end encrypted private messages between friends (Multiplayer, stage C).
-- Additive only: two new tables and new functions. Requires migrations 001-019.
-- The server stores ONLY public keys and ciphertext. Every device makes its own ECDH P-256 key pair in the
-- browser (WebCrypto, private key non-extractable, kept in IndexedDB); a message is encrypted separately for
-- each active device of both people with AES-GCM under an ECDH + HKDF key, so the server, trackers or anyone
-- reading the database cannot read it, and any change to the ciphertext makes decryption fail on the device.
-- Messages can only be sent between friends. Everything is reached only through the blind-quiz-api Edge Function.
-- Requested by the owner on 6 Oct 2026. Applied only by .github/workflows/apply-migration-020.yml.
begin;
create table if not exists public.bq_devices (
  device_id uuid primary key,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  public_key text not null check (public_key ~ '^[A-Za-z0-9+/]{87}=$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists bq_devices_profile_idx on public.bq_devices (profile_id, last_used_at desc);

create table if not exists public.bq_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.bq_profiles(id) on delete cascade,
  recipient_id uuid not null references public.bq_profiles(id) on delete cascade,
  sender_device_id uuid not null references public.bq_devices(device_id) on delete cascade,
  boxes jsonb not null check (jsonb_typeof(boxes) = 'object' and octet_length(boxes::text) <= 24000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists bq_messages_pair_idx on public.bq_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), id desc);
create index if not exists bq_messages_recipient_idx on public.bq_messages (recipient_id, read_at);

alter table public.bq_devices enable row level security;
alter table public.bq_messages enable row level security;
revoke all on public.bq_devices, public.bq_messages from public, anon, authenticated;
grant select, insert, update, delete on public.bq_devices, public.bq_messages to service_role;

-- Registers (or refreshes) this device's public key. At most 4 active devices: the least recently used is retired.
create or replace function public.bq_register_device(p_profile_id uuid, p_device_id uuid, p_public_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare owner uuid; existing text;
begin
  if p_public_key is null or p_public_key !~ '^[A-Za-z0-9+/]{87}=$' then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  select profile_id, public_key into owner, existing from public.bq_devices where device_id = p_device_id;
  if owner is not null and (owner <> p_profile_id or existing <> p_public_key) then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if owner is null then
    insert into public.bq_devices (device_id, profile_id, public_key) values (p_device_id, p_profile_id, p_public_key);
  else
    update public.bq_devices set last_used_at = now(), revoked_at = null where device_id = p_device_id;
  end if;
  update public.bq_devices set revoked_at = now() where profile_id = p_profile_id and revoked_at is null and device_id in (
    select device_id from public.bq_devices where profile_id = p_profile_id and revoked_at is null order by last_used_at desc offset 4);
  return jsonb_build_object('ok', true);
end; $$;

-- Public keys of a friend's active devices and of the caller's own active devices (needed to encrypt a message).
create or replace function public.bq_message_keys(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare other uuid;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_relation(p_profile_id, other) <> 'friends' then return jsonb_build_object('ok', false, 'code', 'not_friends'); end if;
  return jsonb_build_object('ok', true,
    'theirs', coalesce((select jsonb_agg(jsonb_build_object('deviceId', device_id, 'publicKey', public_key) order by created_at) from public.bq_devices where profile_id = other and revoked_at is null), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('deviceId', device_id, 'publicKey', public_key) order by created_at) from public.bq_devices where profile_id = p_profile_id and revoked_at is null), '[]'::jsonb));
end; $$;

-- Stores one encrypted message: one sealed box per active device of the two friends. The server cannot read it.
create or replace function public.bq_send_message(p_profile_id uuid, p_name_normalized text, p_sender_device uuid, p_boxes jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; bad integer; for_them integer; new_id bigint;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
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
  if not exists (select 1 from public.bq_notifications where profile_id = other and kind = 'message' and actor_id = p_profile_id and read_at is null) then
    insert into public.bq_notifications (profile_id, kind, actor_id) values (other, 'message', p_profile_id);
  end if;
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

-- The latest messages between the caller and one other player, with only this device's sealed box.
-- Opening the conversation marks the caller's received messages (and message notifications from that player) read.
create or replace function public.bq_messages_with(p_profile_id uuid, p_name_normalized text, p_device_id uuid, p_after_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; rows jsonb;
begin
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint), '[]'::jsonb) into rows from (
    select jsonb_build_object('id', m.id, 'fromMe', m.sender_id = p_profile_id, 'createdAt', m.created_at, 'read', m.read_at is not null,
      'senderDevice', m.sender_device_id, 'senderKey', d.public_key, 'box', m.boxes -> p_device_id::text) as x
    from public.bq_messages m join public.bq_devices d on d.device_id = m.sender_device_id
    where ((m.sender_id = p_profile_id and m.recipient_id = other) or (m.sender_id = other and m.recipient_id = p_profile_id))
      and m.id > coalesce(p_after_id, 0)
    order by m.id desc limit 100) t;
  update public.bq_messages set read_at = now() where recipient_id = p_profile_id and sender_id = other and read_at is null;
  update public.bq_notifications set read_at = now() where profile_id = p_profile_id and kind = 'message' and actor_id = other and read_at is null;
  return jsonb_build_object('ok', true, 'relation', public.bq_relation(p_profile_id, other), 'messages', rows);
end; $$;

-- Conversations: friends and anyone with messages, newest first, with unread counts.
create or replace function public.bq_conversations(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'lastAt', c.last_at, 'unread', c.unread,
      'online', coalesce(p.last_seen_at > now() - interval '2 minutes', false)) order by c.last_at desc), '[]'::jsonb)
  from (select case when sender_id = p_profile_id then recipient_id else sender_id end as other, max(created_at) as last_at,
          count(*) filter (where recipient_id = p_profile_id and read_at is null) as unread
        from public.bq_messages where sender_id = p_profile_id or recipient_id = p_profile_id group by 1 order by 2 desc limit 50) c
  join public.bq_profiles p on p.id = c.other;
$$;

revoke all on function public.bq_register_device(uuid, uuid, text), public.bq_message_keys(uuid, text), public.bq_send_message(uuid, text, uuid, jsonb),
  public.bq_messages_with(uuid, text, uuid, bigint), public.bq_conversations(uuid) from public, anon, authenticated;
grant execute on function public.bq_register_device(uuid, uuid, text), public.bq_message_keys(uuid, text), public.bq_send_message(uuid, text, uuid, jsonb),
  public.bq_messages_with(uuid, text, uuid, bigint), public.bq_conversations(uuid) to service_role;
commit;
