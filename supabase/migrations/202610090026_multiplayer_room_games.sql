-- Migration 026: synchronized room matches, ready-up lobbies, selectable player seats, game invites and threaded comments.
-- Additive to the already-applied room schema. Migrations 009-025 are not changed or replayed.
begin;

alter table public.bq_room_games add column if not exists phase text not null default 'playing';
alter table public.bq_room_games add column if not exists max_players smallint not null default 6;
alter table public.bq_room_games add column if not exists state jsonb not null default '{}'::jsonb;
alter table public.bq_room_game_players add column if not exists seat smallint;
alter table public.bq_room_game_players add column if not exists ready boolean not null default false;
alter table public.bq_room_game_players add column if not exists last_seen_at timestamptz not null default now();
alter table public.bq_room_events add column if not exists reply_to bigint references public.bq_room_events(id) on delete set null;

update public.bq_room_games set phase = case when status = 'finished' then 'finished' else 'playing' end;
-- A pre-026 room quiz has only client event logs, not a shared question/state snapshot, so it cannot resume in the new synchronized player.
update public.bq_room_games set status='finished',phase='finished',finished_at=coalesce(finished_at,now()) where kind='quiz' and status='playing';
with ranked as (
  select game_id, profile_id, row_number() over (partition by game_id order by joined_at, profile_id) as n
  from public.bq_room_game_players
)
update public.bq_room_game_players gp set seat = ranked.n::smallint
from ranked where gp.game_id = ranked.game_id and gp.profile_id = ranked.profile_id and gp.seat is null;

alter table public.bq_room_game_players alter column seat set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.bq_room_games'::regclass and conname = 'bq_room_games_phase_check') then
    alter table public.bq_room_games add constraint bq_room_games_phase_check check (phase in ('lobby','playing','finished'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bq_room_games'::regclass and conname = 'bq_room_games_max_players_check') then
    alter table public.bq_room_games add constraint bq_room_games_max_players_check check (max_players between 1 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bq_room_games'::regclass and conname = 'bq_room_games_state_check') then
    alter table public.bq_room_games add constraint bq_room_games_state_check check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 24000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bq_room_game_players'::regclass and conname = 'bq_room_game_players_seat_check') then
    alter table public.bq_room_game_players add constraint bq_room_game_players_seat_check check (seat between 1 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bq_room_games'::regclass and conname = 'bq_room_games_kind_check') then
    alter table public.bq_room_games add constraint bq_room_games_kind_check check (kind in ('quiz','letters','soundmatch','snakes','ludo','carrom','blackjack','chess'));
  end if;
end $$;

-- Replace the original three-kind check only; all prior data and tables are preserved.
alter table public.bq_room_games drop constraint if exists bq_room_games_kind_check;
alter table public.bq_room_games add constraint bq_room_games_kind_check
  check (kind in ('quiz','letters','soundmatch','snakes','ludo','carrom','blackjack','chess'));
create unique index if not exists bq_room_game_seat_idx on public.bq_room_game_players (game_id, seat);
create index if not exists bq_room_game_ready_idx on public.bq_room_game_players (game_id, ready, seat);

-- New games enter a lobby for synchronized quiz/board modes; the older independent Letters and Sound Match games keep working.
create or replace function public.bq_game_create(p_profile_id uuid, p_room_id uuid, p_kind text, p_title text, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid; target integer; sync_kind boolean;
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  if p_kind not in ('quiz','letters','soundmatch','snakes','ludo','carrom','blackjack','chess') or p_title is null or char_length(p_title) < 3 or char_length(p_title) > 80
    or p_config is null or jsonb_typeof(p_config) <> 'object' or octet_length(p_config::text) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if coalesce(p_config->>'players', case when p_kind in ('letters','soundmatch') then '6' else '2' end) !~ '^[1-6]$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  target := coalesce(p_config->>'players', case when p_kind in ('letters','soundmatch') then '6' else '2' end)::integer;
  if (p_kind = 'ludo' and target > 4) or (p_kind in ('chess','carrom','blackjack') and target > 2) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  sync_kind := p_kind in ('quiz','snakes','ludo','carrom','blackjack','chess');
  if (select count(*) from public.bq_room_games where host_id = p_profile_id and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  update public.bq_room_games set status = 'finished', phase = 'finished', finished_at = coalesce(finished_at,now())
    where host_id = p_profile_id and status = 'playing';
  insert into public.bq_room_games (room_id, host_id, kind, title, config, status, phase, max_players, state)
    values (p_room_id, p_profile_id, p_kind, p_title, p_config, 'playing', case when sync_kind then 'lobby' else 'playing' end, target, '{}'::jsonb)
    returning id into new_id;
  insert into public.bq_room_game_players (game_id, profile_id, seat, ready) values (new_id, p_profile_id, 1, not sync_kind);
  return jsonb_build_object('ok', true, 'id', new_id, 'maxPlayers', target, 'phase', case when sync_kind then 'lobby' else 'playing' end);
end; $$;

-- An additive comment RPC carries a reply parent. The older room-chat function remains untouched.
create or replace function public.bq_room_comment(p_profile_id uuid, p_room_id uuid, p_game_id uuid, p_reply_to bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare parent_game uuid;
begin
  if not public.bq_room_can(p_profile_id, p_room_id) then return jsonb_build_object('ok', false, 'code', 'room_unavailable'); end if;
  if p_game_id is null or p_body is null or char_length(p_body) < 1 or char_length(p_body) > 300
    or not exists (select 1 from public.bq_room_games where id = p_game_id and room_id = p_room_id) then
    return jsonb_build_object('ok', false, 'code', 'game_unavailable');
  end if;
  if p_reply_to is not null then
    select game_id into parent_game from public.bq_room_events where id = p_reply_to and room_id = p_room_id and kind = 'comment';
    if parent_game is distinct from p_game_id then return jsonb_build_object('ok', false, 'code', 'comment_unavailable'); end if;
  end if;
  insert into public.bq_room_events (room_id, game_id, profile_id, kind, body, reply_to)
    values (p_room_id, p_game_id, p_profile_id, 'comment', p_body, p_reply_to);
  return jsonb_build_object('ok', true);
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
  update public.bq_room_games set status = 'finished', phase = 'finished', finished_at = now()
    where room_id = p_room_id and status = 'playing' and created_at < now() - interval '2 hours';
  delete from public.bq_room_voices where created_at < now() - interval '24 hours';
  return jsonb_build_object('ok', true,
    'room', jsonb_build_object('id',r.id,'name',r.name,'isPublic',r.is_public,'mine',r.owner_id=p_profile_id,'isDefault',r.is_default),
    'people', coalesce((select jsonb_agg(jsonb_build_object('name',p.display_name,'level',p.level) order by p.display_name)
      from public.bq_room_members m join public.bq_profiles p on p.id=m.profile_id where m.room_id=p_room_id and m.last_seen_at>now()-interval '2 minutes'),'[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'kind',g.kind,'title',g.title,'config',g.config,'status',g.status,'phase',g.phase,'maxPlayers',g.max_players,
        'host',(select display_name from public.bq_profiles where id=g.host_id),'hostMe',g.host_id=p_profile_id,'createdAt',g.created_at,
        'commentCount',(select count(*) from public.bq_room_events e where e.game_id=g.id and e.kind='comment'),
        'recentComments',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'body',e.body,'replyTo',e.reply_to,'replyName',rp.display_name) order by e.id),'[]'::jsonb)
          from (select * from public.bq_room_events where game_id=g.id and kind='comment' order by id desc limit 3) e join public.bq_profiles p on p.id=e.profile_id
          left join public.bq_room_events parent on parent.id=e.reply_to left join public.bq_profiles rp on rp.id=parent.profile_id),
        'players',(select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'score',gp.score,'finished',gp.finished,'seat',gp.seat,'ready',gp.ready) order by gp.seat),'[]'::jsonb)
          from public.bq_room_game_players gp join public.bq_profiles p on p.id=gp.profile_id where gp.game_id=g.id)) order by g.created_at desc)
      from (select * from public.bq_room_games where room_id=p_room_id and (status='playing' or finished_at>now()-interval '15 minutes') order by created_at desc limit 20) g),'[]'::jsonb),
    'voices',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',p.display_name,'durationMs',v.duration_ms,'createdAt',v.created_at) order by v.id)
      from (select * from public.bq_room_voices where room_id=p_room_id and created_at>now()-interval '24 hours' order by id desc limit 30) v
      join public.bq_profiles p on p.id=v.profile_id),'[]'::jsonb),
    'chat', coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'body',e.body,'createdAt',e.created_at) order by e.id)
      from (select * from public.bq_room_events where room_id=p_room_id and kind='chat' and id>coalesce(p_after,0) order by id desc limit 50) e
      join public.bq_profiles p on p.id=e.profile_id),'[]'::jsonb));
end; $$;

create or replace function public.bq_game_join_seat(p_profile_id uuid, p_game_id uuid, p_seat smallint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; chosen smallint; existing public.bq_room_game_players%rowtype;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or not public.bq_room_can(p_profile_id,g.room_id) then return jsonb_build_object('ok',false,'code','game_unavailable'); end if;
  if g.status <> 'playing' or g.phase='finished' then return jsonb_build_object('ok',false,'code','game_finished'); end if;
  select * into existing from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id;
  if found then
    update public.bq_room_game_players set last_seen_at=now() where game_id=p_game_id and profile_id=p_profile_id;
    return jsonb_build_object('ok',true,'kind',g.kind,'config',g.config,'title',g.title,'seat',existing.seat,'host',g.host_id=p_profile_id,'phase',g.phase,'maxPlayers',g.max_players);
  end if;
  if g.phase <> 'lobby' and g.kind not in ('letters','soundmatch') then return jsonb_build_object('ok',false,'code','game_started'); end if;
  if p_seat < 0 or p_seat > g.max_players then return jsonb_build_object('ok',false,'code','invalid_request'); end if;
  if p_seat=0 then
    select candidate::smallint into chosen from generate_series(2,g.max_players) candidate
      where not exists(select 1 from public.bq_room_game_players gp where gp.game_id=p_game_id and gp.seat=candidate) order by candidate limit 1;
  else chosen:=p_seat; end if;
  if chosen is null then return jsonb_build_object('ok',false,'code','game_full'); end if;
  if exists(select 1 from public.bq_room_game_players where game_id=p_game_id and seat=chosen) then return jsonb_build_object('ok',false,'code','seat_taken'); end if;
  insert into public.bq_room_game_players(game_id,profile_id,seat,ready) values(p_game_id,p_profile_id,chosen,g.kind in ('letters','soundmatch'));
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'join','');
  return jsonb_build_object('ok',true,'kind',g.kind,'config',g.config,'title',g.title,'seat',chosen,'host',false,'phase',g.phase,'maxPlayers',g.max_players);
end; $$;

-- Keep the original two-argument join RPC compatible with old webviews while assigning a real seat.
create or replace function public.bq_game_join(p_profile_id uuid, p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.bq_game_join_seat(p_profile_id,p_game_id,0::smallint);
end; $$;

-- Preserve the existing broadcast endpoint for Letters/Sound Match; host endings also advance the new phase column.
create or replace function public.bq_game_post(p_profile_id uuid, p_game_id uuid, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; ev jsonb; k text; b text; n integer:=0;
begin
  select * into g from public.bq_room_games where id=p_game_id;
  if not found or not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id) then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.status<>'playing' then return jsonb_build_object('ok',false,'code','game_finished');end if;
  if g.kind in ('quiz','snakes','ludo','carrom','blackjack','chess') then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>40 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  for ev in select value from jsonb_array_elements(p_events) loop
    k:=ev->>'k';b:=left(coalesce(ev->>'b',''),400);
    if k not in ('say','sfx','match','score','end') then continue;end if;
    if k in ('sfx','match') and b !~ '^[a-z0-9_]{1,40}$' then continue;end if;
    if k='score' and g.kind not in ('letters','soundmatch') then continue;end if;
    if k='end' and g.kind in ('quiz','snakes','ludo','carrom','blackjack','chess') then continue;end if;
    if k='score' then if b !~ '^[0-9]{1,6}$' then continue;end if;update public.bq_room_game_players set score=b::integer where game_id=p_game_id and profile_id=p_profile_id;end if;
    if k='end' then
      update public.bq_room_game_players set finished=true where game_id=p_game_id and profile_id=p_profile_id;
      if g.host_id=p_profile_id then update public.bq_room_games set status='finished',phase='finished',finished_at=now() where id=p_game_id;end if;
    end if;
    insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,k,b);n:=n+1;
  end loop;
  return jsonb_build_object('ok',true,'stored',n);
end; $$;

create or replace function public.bq_game_ready(p_profile_id uuid, p_game_id uuid, p_ready boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; n integer;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id) then return jsonb_build_object('ok',false,'code','game_unavailable'); end if;
  if g.phase <> 'lobby' or g.status <> 'playing' then return jsonb_build_object('ok',false,'code','game_started'); end if;
  update public.bq_room_game_players set ready=p_ready,last_seen_at=now() where game_id=p_game_id and profile_id=p_profile_id;
  select count(*) into n from public.bq_room_game_players where game_id=p_game_id and ready;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',
    (select display_name from public.bq_profiles where id=p_profile_id) || case when p_ready then ' is ready.' else ' is not ready yet.' end);
  return jsonb_build_object('ok',true,'ready',p_ready,'readyCount',n);
end; $$;

create or replace function public.bq_blackjack_value(p_hand jsonb)
returns integer language plpgsql immutable set search_path = public, pg_temp as $$
declare card text; rank_name text; total integer:=0; aces integer:=0;
begin
  if jsonb_typeof(p_hand)<>'array' then return 0; end if;
  for card in select value from jsonb_array_elements_text(p_hand) as x(value) loop
    rank_name:=left(card,greatest(0,char_length(card)-1));
    if rank_name='A' then total:=total+11;aces:=aces+1;
    elsif rank_name in ('K','Q','J') then total:=total+10;
    else total:=total+coalesce(nullif(rank_name,'')::integer,0);end if;
  end loop;
  while total>21 and aces>0 loop total:=total-10;aces:=aces-1;end loop;
  return total;
end; $$;

create or replace function public.bq_game_start(p_profile_id uuid, p_game_id uuid, p_initial_state jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; n integer; keys jsonb; ids jsonb; server_keys jsonb; missing_count integer; new_state jsonb; deck jsonb; players jsonb; dealer jsonb:='[]'::jsonb; draw_index integer:=0; seat_index integer; round_index integer; question_row record; option_list jsonb; yes_no_candidates jsonb:='[]'::jsonb; candidate text;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or g.host_id<>p_profile_id then return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if g.phase <> 'lobby' or g.status <> 'playing' then return jsonb_build_object('ok',false,'code','game_started'); end if;
  select count(*) into n from public.bq_room_game_players where game_id=p_game_id;
  if n<g.max_players then return jsonb_build_object('ok',false,'code','waiting_for_players'); end if;
  if exists(select 1 from public.bq_room_game_players where game_id=p_game_id and not ready) then return jsonb_build_object('ok',false,'code','players_not_ready'); end if;
  if g.kind='quiz' then
    ids:=p_initial_state->'questionIds';keys:=p_initial_state->'answerKeys';
    if p_initial_state is null or jsonb_typeof(p_initial_state)<>'object' or octet_length(p_initial_state::text)>20000
      or jsonb_typeof(ids)<>'array' or jsonb_typeof(keys)<>'array' then
      return jsonb_build_object('ok',false,'code','invalid_request');
    end if;
    if jsonb_array_length(ids)<1 or jsonb_array_length(ids)>20 or jsonb_array_length(ids)<>jsonb_array_length(keys)
      or exists(select 1 from jsonb_array_elements(ids) as x(value) where jsonb_typeof(x.value)<>'string' or x.value#>>'{}' !~ '^bq-en-[0-9]{4}$')
      or exists(select 1 from jsonb_array_elements(keys) as x(value) where jsonb_typeof(x.value)<>'string' or char_length(x.value#>>'{}')<1 or char_length(x.value#>>'{}')>200)
      or exists(select x.value from jsonb_array_elements_text(ids) as x(value) group by x.value having count(*)>1) then
      return jsonb_build_object('ok',false,'code','invalid_request');
    end if;
    select jsonb_agg(coalesce(to_jsonb(q.correct_answer),to_jsonb(keys->>(x.ordinality-1)::integer)) order by x.ordinality),
      count(*) filter(where q.id is null)
      into server_keys,missing_count
      from jsonb_array_elements_text(ids) with ordinality as x(value,ordinality)
      left join public.bq_questions q on q.id=x.value and q.active;
    if missing_count>0 and exists(
      select 1 from jsonb_array_elements_text(ids) with ordinality as x(value,ordinality)
      left join public.bq_questions q on q.id=x.value and q.active
      where q.id is null and substring(x.value from 7)::integer not between 1417 and 1916
    ) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    if g.config->>'mode'='yesno' then
      if missing_count>0 then
        if jsonb_typeof(p_initial_state->'answerOptions') is distinct from 'array' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
        if jsonb_array_length(p_initial_state->'answerOptions')<>jsonb_array_length(ids) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
      end if;
      for question_row in select value,ordinality from jsonb_array_elements_text(ids) with ordinality as x(value,ordinality) loop
        select q.answers into option_list from public.bq_questions q where q.id=question_row.value and q.active;
        if not found then
          option_list:=p_initial_state->'answerOptions'->(question_row.ordinality-1)::integer;
          if jsonb_typeof(option_list) is distinct from 'array' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
          if jsonb_array_length(option_list)<2 or jsonb_array_length(option_list)>4 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
          if exists(select 1 from jsonb_array_elements(option_list) as answer(value) where jsonb_typeof(answer.value)<>'string' or char_length(answer.value#>>'{}')<1 or char_length(answer.value#>>'{}')>200)
            or not option_list @> jsonb_build_array(keys->>(question_row.ordinality-1)::integer) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
        end if;
        candidate:=option_list->>floor(random()*jsonb_array_length(option_list))::integer;
        yes_no_candidates:=yes_no_candidates||jsonb_build_array(candidate);
      end loop;
    end if;
    new_state:=jsonb_build_object('questionIds',ids,'answerKeys',server_keys,'currentIndex',0,'attempts','{}'::jsonb,'solvedAt',null,'questionStartedAt',now());
    if g.config->>'mode'='yesno' then new_state:=new_state||jsonb_build_object('yesNoCandidates',yes_no_candidates);end if;
  else
    if p_initial_state is null or jsonb_typeof(p_initial_state)<>'object' or p_initial_state->>'kind'<>g.kind or octet_length(p_initial_state::text)>20000 then
      return jsonb_build_object('ok',false,'code','invalid_request');
    end if;
    if g.kind='blackjack' then
      select jsonb_agg(card order by random()) into deck from (
        select rank_name||suit as card from unnest(array['A','2','3','4','5','6','7','8','9','10','J','Q','K']) as ranks(rank_name)
        cross join unnest(array['♠','♥','♦','♣']) as suits(suit)
      ) shuffled_deck;
      select coalesce(jsonb_agg(jsonb_build_object('seat',gp.seat,'score',0,'hand','[]'::jsonb,'stood',false,'bust',false) order by gp.seat),'[]'::jsonb)
        into players from public.bq_room_game_players gp where gp.game_id=p_game_id;
      for round_index in 1..2 loop
        for seat_index in 0..jsonb_array_length(players)-1 loop
          players:=jsonb_set(players,ARRAY[seat_index::text,'hand'],(players->seat_index->'hand')||jsonb_build_array(deck->>draw_index),true);
          draw_index:=draw_index+1;
        end loop;
        dealer:=dealer||jsonb_build_array(deck->>draw_index);draw_index:=draw_index+1;
      end loop;
      new_state:=jsonb_build_object('kind','blackjack','players',players,'dealer',dealer,'deck',deck,'drawAt',draw_index,'turnSeat',1,'winner',null,'finished',false);
    else new_state:=p_initial_state;end if;
  end if;
  update public.bq_room_games set phase='playing',state=new_state where id=p_game_id;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',g.title||' is starting. Good luck!');
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'sfx','go');
  return jsonb_build_object('ok',true,'phase','playing');
end; $$;

-- First correct answer in each shared question earns 2 points; another correct answer in the short reveal window earns 1.
create or replace function public.bq_game_answer(p_profile_id uuid, p_game_id uuid, p_question_index integer, p_answer text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; idx integer; total integer; key text; candidate text; correct boolean; points integer:=0; attempts jsonb; answered_count integer; solved timestamptz; started timestamptz; qnext integer; player_name text;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or g.kind<>'quiz' or g.phase<>'playing' or not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id) then
    return jsonb_build_object('ok',false,'code','game_unavailable');
  end if;
  idx:=coalesce((g.state->>'currentIndex')::integer,0);total:=jsonb_array_length(g.state->'questionIds');
  if p_question_index<>idx or idx>=total then return jsonb_build_object('ok',false,'code','stale_question','currentIndex',idx); end if;
  solved:=nullif(g.state->>'solvedAt','')::timestamptz;started:=nullif(g.state->>'questionStartedAt','')::timestamptz;
  if (solved is not null and solved<now()-interval '3 seconds') or (started is not null and started < now() - case when g.config->>'mode'='quickdecision' then interval '5 seconds' when g.config->>'mode'='rapid' then interval '15 seconds' when g.config->>'mode'='timeattack' then interval '10 seconds' else interval '30 seconds' end) then
    qnext:=idx+1;g.state:=jsonb_set(g.state,'{currentIndex}',to_jsonb(qnext),true);g.state:=jsonb_set(g.state,'{solvedAt}','null'::jsonb,true);g.state:=jsonb_set(g.state,'{questionStartedAt}',to_jsonb(now()),true);
    update public.bq_room_games set state=g.state,phase=case when qnext>=total then 'finished' else 'playing' end,status=case when qnext>=total then 'finished' else 'playing' end,finished_at=case when qnext>=total then now() else null end where id=p_game_id;
    return jsonb_build_object('ok',false,'code','stale_question','currentIndex',qnext);
  end if;
  attempts:=coalesce(g.state->'attempts'->idx::text,'{}'::jsonb);
  if attempts ? p_profile_id::text then return jsonb_build_object('ok',true,'correct',attempts->>p_profile_id::text='true','points',0,'alreadyAnswered',true,'currentIndex',idx); end if;
  if p_answer is null or char_length(p_answer)>200 then return jsonb_build_object('ok',false,'code','invalid_request'); end if;
  key:=g.state->'answerKeys'->>idx;
  if g.config->>'mode'='yesno' then
    if lower(btrim(p_answer)) not in ('yes','no') then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    candidate:=g.state->'yesNoCandidates'->>idx;if candidate is null then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    correct:=case when lower(btrim(candidate))=lower(btrim(key)) then lower(btrim(p_answer))='yes' else lower(btrim(p_answer))='no' end;
  else correct:=lower(btrim(p_answer))=lower(btrim(key));end if;
  solved:=nullif(g.state->>'solvedAt','')::timestamptz;
  if correct then points:=case when solved is null then 2 else 1 end;update public.bq_room_game_players set score=score+points,last_seen_at=now() where game_id=p_game_id and profile_id=p_profile_id;end if;
  attempts:=jsonb_set(attempts,ARRAY[p_profile_id::text],to_jsonb(correct),true);g.state:=jsonb_set(g.state,ARRAY['attempts',idx::text],attempts,true);
  if correct and solved is null then g.state:=jsonb_set(g.state,'{solvedAt}',to_jsonb(now()),true);end if;
  select count(*) into answered_count from jsonb_object_keys(attempts);
  select display_name into player_name from public.bq_profiles where id=p_profile_id;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'sfx',case when correct then 'correct' else 'wrong' end);
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',case when correct then player_name||' answered correctly and earned '||points||' point(s).' else player_name||' tried an answer. The question is still open.' end);
  select count(*) into total from public.bq_room_game_players where game_id=p_game_id;
  qnext:=idx;
  if answered_count>=total and (solved is null or not correct) then qnext:=idx+1;end if;
  if qnext<>idx then
    g.state:=jsonb_set(g.state,'{currentIndex}',to_jsonb(qnext),true);g.state:=jsonb_set(g.state,'{solvedAt}','null'::jsonb,true);g.state:=jsonb_set(g.state,'{questionStartedAt}',to_jsonb(now()),true);
  end if;
  update public.bq_room_games set state=g.state,phase=case when qnext>=jsonb_array_length(g.state->'questionIds') then 'finished' else 'playing' end,
    status=case when qnext>=jsonb_array_length(g.state->'questionIds') then 'finished' else 'playing' end,
    finished_at=case when qnext>=jsonb_array_length(g.state->'questionIds') then now() else null end where id=p_game_id;
  if qnext>=jsonb_array_length(g.state->'questionIds') then update public.bq_room_game_players set finished=true where game_id=p_game_id;end if;
  return jsonb_build_object('ok',true,'correct',correct,'points',points,'currentIndex',qnext,'finished',qnext>=jsonb_array_length(g.state->'questionIds'));
end; $$;

-- Room members and friends can be invited; accepting joins the first free numbered seat.
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

create or replace function public.bq_game_invite_respond(p_profile_id uuid, p_game_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; inviter uuid; joined jsonb;
begin
  select * into g from public.bq_room_games where id=p_game_id;
  if not found or g.phase<>'lobby' or g.status<>'playing' then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  select actor_id into inviter from public.bq_notifications where profile_id=p_profile_id and kind='game_invite' and ref=p_game_id::text
    and body like 'game-invite|%' and created_at>now()-interval '1 day' order by created_at desc limit 1;
  if inviter is null then return jsonb_build_object('ok',false,'code','request_unavailable');end if;
  update public.bq_notifications set read_at=coalesce(read_at,now()) where profile_id=p_profile_id and kind='game_invite' and ref=p_game_id::text and actor_id=inviter;
  if not p_accept then return jsonb_build_object('ok',true,'accepted',false);end if;
  joined:=public.bq_game_join_seat(p_profile_id,p_game_id,0::smallint);
  if joined->>'ok'<>'true' then return joined;end if;
  return jsonb_build_object('ok',true,'accepted',true,'roomId',g.room_id,'gameId',p_game_id,'seat',joined->'seat','title',g.title);
end; $$;

create or replace function public.bq_game_action(p_profile_id uuid, p_game_id uuid, p_action jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.bq_room_games%rowtype; seat smallint; next_state jsonb; state_players jsonb; player jsonb; hand jsonb; dealer jsonb;
  say_text text; sfx text; p jsonb; finished boolean:=false; draw_index integer; next_seat integer; player_value integer; dealer_value integer;
  player_score integer; winner integer:=-1; all_push boolean:=true; i integer; card text;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or g.kind not in ('snakes','ludo','carrom','blackjack','chess') or g.phase<>'playing' or g.status<>'playing' then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  select gp.seat into seat from public.bq_room_game_players gp where gp.game_id=p_game_id and gp.profile_id=p_profile_id;
  if seat is null then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if p_action->'expectedState' is distinct from g.state then return jsonb_build_object('ok',false,'code','stale_action');end if;
  if coalesce((g.state->>'turnSeat')::integer,0)<>seat then return jsonb_build_object('ok',false,'code','not_your_turn');end if;
  if p_action is null or jsonb_typeof(p_action)<>'object' or p_action->>'type' is null or p_action->>'type' not in ('roll','move','strike','hit','stand') then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  say_text:=left(coalesce(p_action->>'announcement',''),300);sfx:=p_action->>'sfx';
  if sfx is null or sfx !~ '^[a-z0-9_]{1,40}$' or (p_action ? 'sounds' and jsonb_typeof(p_action->'sounds')<>'array')
    or coalesce(jsonb_array_length(case when jsonb_typeof(p_action->'sounds')='array' then p_action->'sounds' else '[]'::jsonb end),0)>3 then
    return jsonb_build_object('ok',false,'code','invalid_request');
  end if;
  if g.kind='blackjack' then
    if p_action->>'type' not in ('hit','stand') or jsonb_typeof(g.state->'deck')<>'array' or jsonb_typeof(g.state->'players')<>'array' then
      return jsonb_build_object('ok',false,'code','invalid_action');
    end if;
    i:=seat-1;player:=g.state->'players'->i;
    if player is null or coalesce((player->>'stood')::boolean,false) or coalesce((player->>'bust')::boolean,false) then return jsonb_build_object('ok',false,'code','invalid_action');end if;
    next_state:=g.state;draw_index:=coalesce((next_state->>'drawAt')::integer,0);
    if p_action->>'type'='hit' then
      if draw_index>=jsonb_array_length(next_state->'deck') then return jsonb_build_object('ok',false,'code','invalid_action');end if;
      card:=next_state->'deck'->>draw_index;hand:=coalesce(player->'hand','[]'::jsonb)||jsonb_build_array(card);
      player:=jsonb_set(player,'{hand}',hand,true);
      player_value:=public.bq_blackjack_value(hand);
      if player_value>21 then player:=jsonb_set(player,'{stood}','true'::jsonb,true);player:=jsonb_set(player,'{bust}','true'::jsonb,true);end if;
      next_state:=jsonb_set(next_state,ARRAY['drawAt'],to_jsonb(draw_index+1),true);
      say_text:=format('Player %s draws a card.',seat);
    else
      player:=jsonb_set(player,'{stood}','true'::jsonb,true);say_text:=format('Player %s stands.',seat);
    end if;
    state_players:=jsonb_set(next_state->'players',ARRAY[i::text],player,true);
    next_state:=jsonb_set(next_state,'{players}',state_players,true);
    if p_action->>'type'='hit' and not coalesce((player->>'bust')::boolean,false) then next_seat:=seat;
    else
      select min((x->>'seat')::integer) into next_seat from jsonb_array_elements(state_players) as t(x)
        where (x->>'seat')::integer>seat and not coalesce((x->>'stood')::boolean,false) and not coalesce((x->>'bust')::boolean,false);
      if next_seat is null then
        select min((x->>'seat')::integer) into next_seat from jsonb_array_elements(state_players) as t(x)
          where not coalesce((x->>'stood')::boolean,false) and not coalesce((x->>'bust')::boolean,false);
      end if;
    end if;
    if next_seat is null then
      dealer:=coalesce(next_state->'dealer','[]'::jsonb);draw_index:=coalesce((next_state->>'drawAt')::integer,0);
      while public.bq_blackjack_value(dealer)<17 and draw_index<jsonb_array_length(next_state->'deck') loop
        dealer:=dealer||jsonb_build_array(next_state->'deck'->>draw_index);draw_index:=draw_index+1;
      end loop;
      next_state:=jsonb_set(next_state,'{dealer}',dealer,true);next_state:=jsonb_set(next_state,'{drawAt}',to_jsonb(draw_index),true);
      dealer_value:=public.bq_blackjack_value(dealer);winner:=-1;all_push:=true;state_players:=next_state->'players';
      for i in 0..jsonb_array_length(state_players)-1 loop
        player:=state_players->i;player_value:=public.bq_blackjack_value(player->'hand');
        if player_value<=21 and (dealer_value>21 or player_value>dealer_value) then player_score:=1;
        elsif player_value=dealer_value and player_value<=21 then player_score:=0;
        else player_score:=-1;end if;
        if player_score=1 and winner=-1 then winner:=(player->>'seat')::integer;end if;
        if player_score<>0 then all_push:=false;end if;
        state_players:=jsonb_set(state_players,ARRAY[i::text,'score'],to_jsonb(player_score),true);
        update public.bq_room_game_players gp set score=player_score,last_seen_at=now() where gp.game_id=p_game_id and gp.seat=(player->>'seat')::smallint;
      end loop;
      if winner=-1 and all_push then winner:=0;end if;
      next_state:=jsonb_set(next_state,'{players}',state_players,true);next_state:=jsonb_set(next_state,'{winner}',to_jsonb(winner),true);next_state:=jsonb_set(next_state,'{finished}','true'::jsonb,true);
      finished:=true;say_text:=format('Dealer has %s. Round complete.',dealer_value);
    else next_state:=jsonb_set(next_state,'{turnSeat}',to_jsonb(next_seat),true);end if;
  else
    next_state:=p_action->'state';
    if next_state is null or jsonb_typeof(next_state)<>'object' or next_state->>'kind'<>g.kind or octet_length(next_state::text)>20000 then
      return jsonb_build_object('ok',false,'code','invalid_request');
    end if;
    finished:=coalesce((next_state->>'finished')::boolean,false);
  end if;
  update public.bq_room_games set state=next_state,phase=case when finished then 'finished' else 'playing' end,
    status=case when finished then 'finished' else 'playing' end,finished_at=case when finished then now() else null end where id=p_game_id;
  if g.kind<>'blackjack' and jsonb_typeof(next_state->'players')='array' then
    for p in select value from jsonb_array_elements(next_state->'players') loop
      if (p->>'seat')~'^[1-6]$' and (p->>'score')~'^-?[0-9]{1,5}$' then
        update public.bq_room_game_players gp set score=(p->>'score')::integer,last_seen_at=now() where gp.game_id=p_game_id and gp.seat=(p->>'seat')::smallint;
      end if;
    end loop;
  end if;
  if finished then update public.bq_room_game_players set finished=true where game_id=p_game_id;end if;
  if say_text<>'' then insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',say_text);end if;
  if jsonb_typeof(p_action->'sounds')='array' then
    for p in select value from jsonb_array_elements(p_action->'sounds') loop
      sfx:=p#>>'{}';if sfx~'^[a-z0-9_]{1,40}$' then insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'sfx',sfx);end if;
    end loop;
  elsif sfx~'^[a-z0-9_]{1,40}$' then
    insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'sfx',sfx);
  end if;
  return jsonb_build_object('ok',true,'finished',finished);
end; $$;

-- Polling also advances a solved/expired shared quiz together for every player and spectator.
create or replace function public.bq_game_watch(p_profile_id uuid, p_game_id uuid, p_after bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_room_games%rowtype; public_state jsonb; idx integer; total integer; solved timestamptz; started timestamptz;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or not public.bq_room_can(p_profile_id,g.room_id) then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.kind='quiz' and g.phase='playing' then
    idx:=coalesce((g.state->>'currentIndex')::integer,0);total:=jsonb_array_length(g.state->'questionIds');solved:=nullif(g.state->>'solvedAt','')::timestamptz;started:=nullif(g.state->>'questionStartedAt','')::timestamptz;
    if idx<total and ((solved is not null and solved<now()-interval '3 seconds') or (started is not null and started < now() - case when g.config->>'mode'='quickdecision' then interval '5 seconds' when g.config->>'mode'='rapid' then interval '15 seconds' when g.config->>'mode'='timeattack' then interval '10 seconds' else interval '30 seconds' end)) then
      idx:=idx+1;g.state:=jsonb_set(g.state,'{currentIndex}',to_jsonb(idx),true);g.state:=jsonb_set(g.state,'{solvedAt}','null'::jsonb,true);g.state:=jsonb_set(g.state,'{questionStartedAt}',to_jsonb(now()),true);
      update public.bq_room_games set state=g.state,phase=case when idx>=total then 'finished' else 'playing' end,status=case when idx>=total then 'finished' else 'playing' end,finished_at=case when idx>=total then now() else null end where id=p_game_id;
      if idx>=total then update public.bq_room_game_players set finished=true where game_id=p_game_id;g.phase:='finished';g.status:='finished';end if;
    end if;
  end if;
  public_state:=g.state-'answerKeys'-'attempts'-'deck';
  if g.kind='blackjack' and g.phase='playing' and jsonb_typeof(g.state->'dealer')='array' and jsonb_array_length(g.state->'dealer')>1 then
    public_state:=jsonb_set(public_state,'{dealer}',jsonb_build_array(g.state->'dealer'->0,to_jsonb('hidden'::text)),true);
  end if;
  return jsonb_build_object('ok',true,'status',g.status,'phase',g.phase,'kind',g.kind,'title',g.title,'roomId',g.room_id,'maxPlayers',g.max_players,
    'host',(select display_name from public.bq_profiles where id=g.host_id),
    'hostMe',g.host_id=p_profile_id,
    'seat',(select seat from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'score',gp.score,'finished',gp.finished,'seat',gp.seat,'ready',gp.ready) order by gp.seat),'[]'::jsonb)
      from public.bq_room_game_players gp join public.bq_profiles p on p.id=gp.profile_id where gp.game_id=p_game_id),
    'state',public_state,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'kind',e.kind,'body',e.body,'replyTo',e.reply_to,'replyName',rp.display_name) order by e.id)
      from (select * from public.bq_room_events where game_id=p_game_id and id>coalesce(p_after,0) order by id limit 120) e
      join public.bq_profiles p on p.id=e.profile_id left join public.bq_room_events parent on parent.id=e.reply_to left join public.bq_profiles rp on rp.id=parent.profile_id),'[]'::jsonb));
end; $$;

create or replace function public.bq_game_state(p_profile_id uuid, p_game_id uuid, p_after bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d jsonb;
begin
  if not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id) then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  d:=public.bq_game_watch(p_profile_id,p_game_id,p_after);
  return d;
end; $$;

revoke all on function public.bq_blackjack_value(jsonb), public.bq_room_comment(uuid,uuid,uuid,bigint,text), public.bq_game_join_seat(uuid,uuid,smallint), public.bq_game_ready(uuid,uuid,boolean),
  public.bq_game_start(uuid,uuid,jsonb), public.bq_game_answer(uuid,uuid,integer,text), public.bq_game_action(uuid,uuid,jsonb), public.bq_game_invite(uuid,uuid,text),
  public.bq_game_invite_respond(uuid,uuid,boolean), public.bq_game_state(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.bq_blackjack_value(jsonb), public.bq_room_comment(uuid,uuid,uuid,bigint,text), public.bq_game_join_seat(uuid,uuid,smallint), public.bq_game_ready(uuid,uuid,boolean),
  public.bq_game_start(uuid,uuid,jsonb), public.bq_game_answer(uuid,uuid,integer,text), public.bq_game_action(uuid,uuid,jsonb), public.bq_game_invite(uuid,uuid,text),
  public.bq_game_invite_respond(uuid,uuid,boolean), public.bq_game_state(uuid,uuid,bigint) to service_role;

commit;
