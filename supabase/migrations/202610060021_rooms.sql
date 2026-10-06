-- Migration 021: rooms, room chat, live room games, spectators and comments (Multiplayer, stage D).
-- Additive only: six new tables, three default public rooms, new functions. Requires migrations 001-020.
-- Public rooms are open to every signed-in player; private rooms only to their owner and invited friends.
-- A room game is played on the players' own devices; each player's device posts small events (sound played,
-- text announced, score). Spectators poll the events and hear the same sounds and announcements with their own
-- settings. Everything is reached only through the blind-quiz-api Edge Function (service_role).
-- Requested by the owner on 6 Oct 2026. Applied only by .github/workflows/apply-migration-021.yml.
begin;
create table if not exists public.bq_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 40),
  is_public boolean not null default true,
  owner_id uuid references public.bq_profiles(id) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists bq_rooms_owner_idx on public.bq_rooms (owner_id);

create table if not exists public.bq_room_access (
  room_id uuid not null references public.bq_rooms(id) on delete cascade,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);

create table if not exists public.bq_room_members (
  room_id uuid not null references public.bq_rooms(id) on delete cascade,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);
create index if not exists bq_room_members_seen_idx on public.bq_room_members (room_id, last_seen_at desc);

create table if not exists public.bq_room_games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.bq_rooms(id) on delete cascade,
  host_id uuid not null references public.bq_profiles(id) on delete cascade,
  kind text not null check (kind in ('quiz', 'letters', 'soundmatch')),
  title text not null check (char_length(title) between 3 and 80),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 500),
  status text not null default 'playing' check (status in ('playing', 'finished')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists bq_room_games_room_idx on public.bq_room_games (room_id, status, created_at desc);

create table if not exists public.bq_room_game_players (
  game_id uuid not null references public.bq_room_games(id) on delete cascade,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  score integer not null default 0,
  finished boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (game_id, profile_id)
);

create table if not exists public.bq_room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.bq_rooms(id) on delete cascade,
  game_id uuid references public.bq_room_games(id) on delete cascade,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  kind text not null check (kind in ('chat', 'comment', 'say', 'sfx', 'match', 'score', 'end', 'join')),
  body text not null default '' check (char_length(body) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists bq_room_events_room_idx on public.bq_room_events (room_id, id);
create index if not exists bq_room_events_game_idx on public.bq_room_events (game_id, id);

alter table public.bq_rooms enable row level security;
alter table public.bq_room_access enable row level security;
alter table public.bq_room_members enable row level security;
alter table public.bq_room_games enable row level security;
alter table public.bq_room_game_players enable row level security;
alter table public.bq_room_events enable row level security;
revoke all on public.bq_rooms, public.bq_room_access, public.bq_room_members, public.bq_room_games, public.bq_room_game_players, public.bq_room_events from public, anon, authenticated;
grant select, insert, update, delete on public.bq_rooms, public.bq_room_access, public.bq_room_members, public.bq_room_games, public.bq_room_game_players, public.bq_room_events to service_role;

insert into public.bq_rooms (id, name, is_public, is_default) values
  ('b1a1d000-0000-4000-8000-000000000001', 'Blind Quiz', true, true),
  ('b1a1d000-0000-4000-8000-000000000002', 'Word Lovers', true, true),
  ('b1a1d000-0000-4000-8000-000000000003', 'Sound Lounge', true, true)
on conflict (id) do nothing;

-- Can this player enter the room? Public rooms: yes. Private rooms: owner or invited.
create or replace function public.bq_room_can(p_profile_id uuid, p_room_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.bq_rooms r where r.id = p_room_id and (r.is_public or r.owner_id = p_profile_id
    or exists (select 1 from public.bq_room_access a where a.room_id = r.id and a.profile_id = p_profile_id)));
$$;

create or replace function public.bq_rooms_list(p_profile_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'isPublic', r.is_public, 'isDefault', r.is_default,
      'mine', r.owner_id = p_profile_id,
      'users', (select count(*) from public.bq_room_members m where m.room_id = r.id and m.last_seen_at > now() - interval '2 minutes'),
      'games', (select count(*) from public.bq_room_games g where g.room_id = r.id and g.status = 'playing' and g.created_at > now() - interval '2 hours'))
    order by r.is_default desc, r.is_public desc, r.created_at), '[]'::jsonb)
  from public.bq_rooms r where public.bq_room_can(p_profile_id, r.id);
$$;

create or replace function public.bq_room_create(p_profile_id uuid, p_name text, p_public boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  if p_name is null or char_length(p_name) < 3 or char_length(p_name) > 40 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if (select count(*) from public.bq_rooms where owner_id = p_profile_id) >= 5 then return jsonb_build_object('ok', false, 'code', 'too_many_requests'); end if;
  insert into public.bq_rooms (name, is_public, owner_id) values (p_name, coalesce(p_public, true), p_profile_id) returning id into new_id;
  insert into public.bq_room_access (room_id, profile_id) values (new_id, p_profile_id);
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

-- The owner removes a room they made (default rooms cannot be removed).
create or replace function public.bq_room_remove(p_profile_id uuid, p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.bq_rooms where id = p_room_id and owner_id = p_profile_id and not is_default;
  if not found then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  return jsonb_build_object('ok', true);
end; $$;

-- Room state for the room screen (also the presence heartbeat): new chat lines after p_after, games, people here.
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
  return jsonb_build_object('ok', true, 'room', jsonb_build_object('id', r.id, 'name', r.name, 'isPublic', r.is_public, 'mine', r.owner_id = p_profile_id, 'isDefault', r.is_default),
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', p.display_name, 'level', p.level) order by p.display_name)
      from public.bq_room_members m join public.bq_profiles p on p.id = m.profile_id where m.room_id = p_room_id and m.last_seen_at > now() - interval '2 minutes'), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'title', g.title, 'config', g.config, 'status', g.status,
        'host', (select display_name from public.bq_profiles where id = g.host_id), 'createdAt', g.created_at,
        'players', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'score', gp.score, 'finished', gp.finished) order by gp.score desc), '[]'::jsonb)
          from public.bq_room_game_players gp join public.bq_profiles p on p.id = gp.profile_id where gp.game_id = g.id)) order by g.created_at desc)
      from (select * from public.bq_room_games where room_id = p_room_id and (status = 'playing' or finished_at > now() - interval '15 minutes') order by created_at desc limit 20) g), '[]'::jsonb),
    'chat', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', p.display_name, 'body', e.body, 'createdAt', e.created_at) order by e.id)
      from (select * from public.bq_room_events where room_id = p_room_id and kind = 'chat' and id > coalesce(p_after, 0) order by id desc limit 50) e
      join public.bq_profiles p on p.id = e.profile_id), '[]'::jsonb));
end; $$;

create or replace function public.bq_room_leave(p_profile_id uuid, p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.bq_room_members set last_seen_at = now() - interval '1 hour' where room_id = p_room_id and profile_id = p_profile_id;
  update public.bq_room_game_players gp set finished = true from public.bq_room_games g
    where gp.game_id = g.id and g.room_id = p_room_id and gp.profile_id = p_profile_id and g.status = 'playing';
  return jsonb_build_object('ok', true);
end; $$;

-- Room chat line, or a comment on a game (p_game_id set).
create or replace function public.bq_room_say(p_profile_id uuid, p_room_id uuid, p_game_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  if p_body is null or char_length(p_body) < 1 or char_length(p_body) > 300 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if p_game_id is not null and not exists (select 1 from public.bq_room_games where id = p_game_id and room_id = p_room_id) then
    return jsonb_build_object('ok', false, 'code', 'game_unavailable');
  end if;
  insert into public.bq_room_events (room_id, game_id, profile_id, kind, body) values (p_room_id, p_game_id, p_profile_id, case when p_game_id is null then 'chat' else 'comment' end, p_body);
  return jsonb_build_object('ok', true);
end; $$;

-- Invite a friend into a room (private rooms get access). The friend is notified.
create or replace function public.bq_room_invite(p_profile_id uuid, p_room_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid;
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  select id into other from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
  if public.bq_relation(p_profile_id, other) <> 'friends' then return jsonb_build_object('ok', false, 'code', 'not_friends'); end if;
  insert into public.bq_room_access (room_id, profile_id) values (p_room_id, other) on conflict do nothing;
  insert into public.bq_notifications (profile_id, kind, actor_id, ref, body)
    values (other, 'room_invite', p_profile_id, p_room_id::text, (select name from public.bq_rooms where id = p_room_id));
  return jsonb_build_object('ok', true);
end; $$;

-- "Send a match" from a friend's card: a private room for the two friends (made once, reused), and a notification.
create or replace function public.bq_match_invite(p_profile_id uuid, p_name_normalized text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare other uuid; room uuid; me_name text; other_name text;
begin
  select id, display_name into other, other_name from public.bq_profiles where name_normalized = p_name_normalized;
  if other is null then return jsonb_build_object('ok', false, 'code', 'player_unavailable'); end if;
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

-- Start a live game in a room. The host is its first player; an earlier live game by the host ends.
create or replace function public.bq_game_create(p_profile_id uuid, p_room_id uuid, p_kind text, p_title text, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  if p_kind not in ('quiz', 'letters', 'soundmatch') or p_title is null or char_length(p_title) < 3 or char_length(p_title) > 80
    or p_config is null or jsonb_typeof(p_config) <> 'object' or octet_length(p_config::text) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if (select count(*) from public.bq_room_games where host_id = p_profile_id and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  update public.bq_room_games set status = 'finished', finished_at = now() where host_id = p_profile_id and status = 'playing';
  insert into public.bq_room_games (room_id, host_id, kind, title, config) values (p_room_id, p_profile_id, p_kind, p_title, p_config) returning id into new_id;
  insert into public.bq_room_game_players (game_id, profile_id) values (new_id, p_profile_id);
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

-- Join a live game as a player (at most 6 players).
create or replace function public.bq_game_join(p_profile_id uuid, p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype;
begin
  select * into g from public.bq_room_games where id = p_game_id;
  if not found or not public.bq_room_can(p_profile_id, g.room_id) then return jsonb_build_object('ok', false, 'code', 'game_unavailable'); end if;
  if g.status <> 'playing' then return jsonb_build_object('ok', false, 'code', 'game_finished'); end if;
  if not exists (select 1 from public.bq_room_game_players where game_id = p_game_id and profile_id = p_profile_id) then
    if (select count(*) from public.bq_room_game_players where game_id = p_game_id) >= 6 then return jsonb_build_object('ok', false, 'code', 'game_full'); end if;
    insert into public.bq_room_game_players (game_id, profile_id) values (p_game_id, p_profile_id);
    insert into public.bq_room_events (room_id, game_id, profile_id, kind) values (g.room_id, p_game_id, p_profile_id, 'join');
  end if;
  return jsonb_build_object('ok', true, 'kind', g.kind, 'config', g.config, 'title', g.title);
end; $$;

-- A player's device posts what happened in its game: sounds, announcements, score, end. Only players can post.
create or replace function public.bq_game_post(p_profile_id uuid, p_game_id uuid, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; ev jsonb; k text; b text; n integer := 0;
begin
  select * into g from public.bq_room_games where id = p_game_id;
  if not found or not exists (select 1 from public.bq_room_game_players where game_id = p_game_id and profile_id = p_profile_id) then
    return jsonb_build_object('ok', false, 'code', 'game_unavailable');
  end if;
  if g.status <> 'playing' then return jsonb_build_object('ok', false, 'code', 'game_finished'); end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 40 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  for ev in select value from jsonb_array_elements(p_events) loop
    k := ev ->> 'k'; b := left(coalesce(ev ->> 'b', ''), 400);
    if k not in ('say', 'sfx', 'match', 'score', 'end') then continue; end if;
    if k in ('sfx', 'match') and b !~ '^[a-z0-9_]{1,40}$' then continue; end if;
    if k = 'score' then
      if b !~ '^[0-9]{1,6}$' then continue; end if;
      update public.bq_room_game_players set score = b::integer where game_id = p_game_id and profile_id = p_profile_id;
    end if;
    if k = 'end' then
      update public.bq_room_game_players set finished = true where game_id = p_game_id and profile_id = p_profile_id;
      if g.host_id = p_profile_id then update public.bq_room_games set status = 'finished', finished_at = now() where id = p_game_id; end if;
    end if;
    insert into public.bq_room_events (room_id, game_id, profile_id, kind, body) values (g.room_id, p_game_id, p_profile_id, k, b);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'stored', n);
end; $$;

-- Spectators (and players) follow a game: events after p_after, players with scores, and the game status.
create or replace function public.bq_game_watch(p_profile_id uuid, p_game_id uuid, p_after bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype;
begin
  select * into g from public.bq_room_games where id = p_game_id;
  if not found or not public.bq_room_can(p_profile_id, g.room_id) then return jsonb_build_object('ok', false, 'code', 'game_unavailable'); end if;
  return jsonb_build_object('ok', true, 'status', g.status, 'kind', g.kind, 'title', g.title, 'roomId', g.room_id,
    'host', (select display_name from public.bq_profiles where id = g.host_id),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'score', gp.score, 'finished', gp.finished) order by gp.score desc), '[]'::jsonb)
      from public.bq_room_game_players gp join public.bq_profiles p on p.id = gp.profile_id where gp.game_id = p_game_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', p.display_name, 'kind', e.kind, 'body', e.body) order by e.id)
      from (select * from public.bq_room_events where game_id = p_game_id and id > coalesce(p_after, 0) order by id limit 120) e
      join public.bq_profiles p on p.id = e.profile_id), '[]'::jsonb));
end; $$;

revoke all on function public.bq_room_can(uuid, uuid), public.bq_rooms_list(uuid), public.bq_room_create(uuid, text, boolean), public.bq_room_remove(uuid, uuid),
  public.bq_room_state(uuid, uuid, bigint), public.bq_room_leave(uuid, uuid), public.bq_room_say(uuid, uuid, uuid, text), public.bq_room_invite(uuid, uuid, text),
  public.bq_match_invite(uuid, text), public.bq_game_create(uuid, uuid, text, text, jsonb), public.bq_game_join(uuid, uuid), public.bq_game_post(uuid, uuid, jsonb),
  public.bq_game_watch(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.bq_room_can(uuid, uuid), public.bq_rooms_list(uuid), public.bq_room_create(uuid, text, boolean), public.bq_room_remove(uuid, uuid),
  public.bq_room_state(uuid, uuid, bigint), public.bq_room_leave(uuid, uuid), public.bq_room_say(uuid, uuid, uuid, text), public.bq_room_invite(uuid, uuid, text),
  public.bq_match_invite(uuid, text), public.bq_game_create(uuid, uuid, text, text, jsonb), public.bq_game_join(uuid, uuid), public.bq_game_post(uuid, uuid, jsonb),
  public.bq_game_watch(uuid, uuid, bigint) to service_role;
commit;
