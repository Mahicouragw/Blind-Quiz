-- Migration 027: assign room members to game seats, choose Ludo/Chess colors, moderate match comments,
-- and run Letters to Words / Sound Match through the same synchronized lobby as quizzes and board games.
-- This builds on draft Migration 026. It does not alter or apply any prior migration.
begin;

alter table public.bq_room_games add column if not exists synchronized boolean not null default false;
alter table public.bq_room_games add column if not exists comments_enabled boolean not null default true;
alter table public.bq_room_games add column if not exists creator_id uuid references public.bq_profiles(id) on delete cascade;
update public.bq_room_games set creator_id=host_id where creator_id is null;
alter table public.bq_room_games alter column creator_id set not null;
create index if not exists bq_room_game_creator_idx on public.bq_room_games(creator_id,created_at desc);
alter table public.bq_room_game_players add column if not exists color text;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.bq_room_game_players'::regclass and conname='bq_room_game_players_color_check') then
    alter table public.bq_room_game_players add constraint bq_room_game_players_color_check
      check(color is null or color in ('red','yellow','green','blue','white','black'));
  end if;
end $$;

-- Games created before this migration retain their legacy mode; existing 026 synchronized games are marked.
update public.bq_room_games set synchronized=true,config=coalesce(config,'{}'::jsonb)||jsonb_build_object('roomSync',true)
  where kind in ('quiz','snakes','ludo','carrom','blackjack','chess') and status='playing';

create or replace function public.bq_game_create(p_profile_id uuid,p_room_id uuid,p_kind text,p_title text,p_config jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare new_id uuid; target integer; sync_kind boolean; cfg jsonb; chosen_host uuid;
begin
  if not public.bq_room_can(p_profile_id,p_room_id) then return jsonb_build_object('ok',false,'code','room_unavailable');end if;
  if p_kind not in ('quiz','letters','soundmatch','snakes','ludo','carrom','blackjack','chess') or p_title is null or char_length(p_title)<3 or char_length(p_title)>80
    or p_config is null or jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>500
    or (p_config ? 'hostName' and char_length(p_config->>'hostName') not between 2 and 40) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if coalesce(p_config->>'players','2') !~ '^[1-6]$' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  target:=coalesce(p_config->>'players','2')::integer;
  if (p_kind='ludo' and (target<2 or target>4)) or (p_kind in ('chess','carrom','blackjack') and target>2) or (p_kind='chess' and target<>2)
    or (p_kind in ('letters','soundmatch') and target<2) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if p_kind='soundmatch' and coalesce(p_config->>'level','easy') not in ('easy','medium','hard') then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if p_kind='quiz' and (coalesce(p_config->>'mode','classic') not in ('classic','yesno','decision','quickdecision','rapid','timeattack','survival')
    or length(coalesce(p_config->>'category','general'))>40) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  chosen_host:=p_profile_id;
  if p_config ? 'hostName' then
    select id into chosen_host from public.bq_profiles where display_name=p_config->>'hostName';
    if chosen_host is null then return jsonb_build_object('ok',false,'code','player_unavailable');end if;
    if not exists(select 1 from public.bq_room_members where room_id=p_room_id and profile_id=chosen_host and last_seen_at>now()-interval '2 minutes') then
      return jsonb_build_object('ok',false,'code','not_room_member');end if;
  end if;
  sync_kind:=p_kind in ('quiz','letters','soundmatch','snakes','ludo','carrom','blackjack','chess');
  cfg:=p_config||jsonb_build_object('roomSync',sync_kind);
  if (select count(*) from public.bq_room_games where creator_id=p_profile_id and created_at>now()-interval '1 hour')>=30 then return jsonb_build_object('ok',false,'code','too_many_requests');end if;
  update public.bq_room_games set status='finished',phase='finished',finished_at=coalesce(finished_at,now()) where (creator_id=p_profile_id or host_id=chosen_host) and status='playing';
  insert into public.bq_room_games(room_id,creator_id,host_id,kind,title,config,status,phase,max_players,state,synchronized,comments_enabled)
    values(p_room_id,p_profile_id,chosen_host,p_kind,p_title,cfg,'playing',case when sync_kind then 'lobby' else 'playing' end,target,'{}'::jsonb,sync_kind,true)
    returning id into new_id;
  insert into public.bq_room_game_players(game_id,profile_id,seat,ready,color) values(new_id,chosen_host,1,false,null);
  if chosen_host<>p_profile_id then
    insert into public.bq_notifications(profile_id,kind,actor_id,ref,body)
      values(chosen_host,'game_invite',p_profile_id,new_id::text,'host-request|'||p_room_id::text||'|'||p_title);
  end if;
  return jsonb_build_object('ok',true,'id',new_id,'maxPlayers',target,'phase',case when sync_kind then 'lobby' else 'playing' end,'synchronized',sync_kind,'hostName',(select display_name from public.bq_profiles where id=chosen_host));
end; $$;

-- Expose live seat colors and lobby options in room cards so players can choose an available color before joining.
create or replace function public.bq_room_state(p_profile_id uuid,p_room_id uuid,p_after bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
        'commentCount',(select count(*) from public.bq_room_events e where e.game_id=g.id and e.kind='comment'),
        'recentComments',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'body',e.body,'replyTo',e.reply_to,'replyName',rp.display_name) order by e.id),'[]'::jsonb)
          from (select * from public.bq_room_events where game_id=g.id and kind='comment' order by id desc limit 3) e join public.bq_profiles p on p.id=e.profile_id
          left join public.bq_room_events parent on parent.id=e.reply_to left join public.bq_profiles rp on rp.id=parent.profile_id),
        'players',(select coalesce(jsonb_agg(jsonb_build_object('name',p.display_name,'score',gp.score,'finished',gp.finished,'seat',gp.seat,'ready',gp.ready,'color',gp.color) order by gp.seat),'[]'::jsonb)
          from public.bq_room_game_players gp join public.bq_profiles p on p.id=gp.profile_id where gp.game_id=g.id)) order by g.created_at desc)
      from (select * from public.bq_room_games where room_id=p_room_id and (status='playing' or finished_at>now()-interval '15 minutes') order by created_at desc limit 20) g),'[]'::jsonb),
    'voices',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',p.display_name,'durationMs',v.duration_ms,'createdAt',v.created_at) order by v.id)
      from (select * from public.bq_room_voices where room_id=p_room_id and created_at>now()-interval '24 hours' order by id desc limit 30) v
      join public.bq_profiles p on p.id=v.profile_id),'[]'::jsonb),
    'chat',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',p.display_name,'body',e.body,'createdAt',e.created_at) order by e.id)
      from (select * from public.bq_room_events where room_id=p_room_id and kind='chat' and id>coalesce(p_after,0) order by id desc limit 50) e
      join public.bq_profiles p on p.id=e.profile_id),'[]'::jsonb));
end; $$;

-- Synchronized modes never accept browser-supplied score, event, board, or match-end state.
create or replace function public.bq_game_post(p_profile_id uuid,p_game_id uuid,p_events jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype;ev jsonb;k text;b text;n integer:=0;
begin
  select * into g from public.bq_room_games where id=p_game_id;
  if not found or not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id) then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.status<>'playing' then return jsonb_build_object('ok',false,'code','game_finished');end if;
  if g.synchronized or g.kind in ('quiz','snakes','ludo','carrom','blackjack','chess') then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>40 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  for ev in select value from jsonb_array_elements(p_events) loop
    k:=ev->>'k';b:=left(coalesce(ev->>'b',''),400);
    if k not in ('say','sfx','match','score','end') then continue;end if;
    if k in ('sfx','match') and b !~ '^[a-z0-9_]{1,40}$' then continue;end if;
    if k='score' and g.kind not in ('letters','soundmatch') then continue;end if;
    if k='end' and g.kind in ('quiz','snakes','ludo','carrom','blackjack','chess') then continue;end if;
    if k='score' then if b !~ '^[0-9]{1,6}$' then continue;end if;update public.bq_room_game_players set score=b::integer where game_id=p_game_id and profile_id=p_profile_id;end if;
    if k='end' then update public.bq_room_game_players set finished=true where game_id=p_game_id and profile_id=p_profile_id;
      if g.host_id=p_profile_id then update public.bq_room_games set status='finished',phase='finished',finished_at=now() where id=p_game_id;end if;end if;
    insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,k,b);n:=n+1;
  end loop;
  return jsonb_build_object('ok',true,'stored',n);
end; $$;

-- A player's own join/seat/color selection. The 3-argument RPC remains as a compatibility wrapper.
create or replace function public.bq_game_join_seat_color(p_profile_id uuid,p_game_id uuid,p_seat smallint,p_color text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype; chosen smallint; existing public.bq_room_game_players%rowtype; valid_color boolean;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or not public.bq_room_can(p_profile_id,g.room_id) then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.status<>'playing' or g.phase='finished' then return jsonb_build_object('ok',false,'code','game_finished');end if;
  valid_color:=case when g.kind='ludo' then p_color is null or p_color in ('red','yellow','green','blue')
    when g.kind='chess' then p_color is null or p_color in ('white','black') else p_color is null end;
  if not valid_color then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if p_color is not null and exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id<>p_profile_id and color=p_color) then
    return jsonb_build_object('ok',false,'code','color_taken');
  end if;
  select * into existing from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id;
  if found then
    if p_seat not in (0,existing.seat) then return jsonb_build_object('ok',false,'code','already_joined');end if;
    if g.phase<>'lobby' and p_color is not null then return jsonb_build_object('ok',false,'code','game_started');end if;
    update public.bq_room_game_players set color=coalesce(p_color,color),ready=case when p_color is not null and existing.color is distinct from p_color then false else ready end,last_seen_at=now() where game_id=p_game_id and profile_id=p_profile_id;
    return jsonb_build_object('ok',true,'kind',g.kind,'config',g.config,'title',g.title,'seat',existing.seat,'color',coalesce(p_color,existing.color),'host',g.host_id=p_profile_id,'phase',g.phase,'maxPlayers',g.max_players);
  end if;
  if g.phase<>'lobby' and not (not g.synchronized and g.kind in ('letters','soundmatch')) then return jsonb_build_object('ok',false,'code','game_started');end if;
  if p_seat<0 or p_seat>g.max_players then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if p_seat=0 then
    select candidate::smallint into chosen from generate_series(2,g.max_players) candidate
      where not exists(select 1 from public.bq_room_game_players gp where gp.game_id=p_game_id and gp.seat=candidate) order by candidate limit 1;
  else chosen:=p_seat;end if;
  if chosen is null then return jsonb_build_object('ok',false,'code','game_full');end if;
  if exists(select 1 from public.bq_room_game_players where game_id=p_game_id and seat=chosen) then return jsonb_build_object('ok',false,'code','seat_taken');end if;
  insert into public.bq_room_game_players(game_id,profile_id,seat,ready,last_seen_at,color)
    values(p_game_id,p_profile_id,chosen,false,now(),p_color);
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'join','');
  return jsonb_build_object('ok',true,'kind',g.kind,'config',g.config,'title',g.title,'seat',chosen,'color',p_color,'host',false,'phase',g.phase,'maxPlayers',g.max_players);
end; $$;

create or replace function public.bq_game_join_seat(p_profile_id uuid,p_game_id uuid,p_seat smallint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin return public.bq_game_join_seat_color(p_profile_id,p_game_id,p_seat,null);end; $$;

-- The creator may select an active room member by their public display name and place them in a numbered seat.
create or replace function public.bq_game_assign_member(p_profile_id uuid,p_game_id uuid,p_name_normalized text,p_seat smallint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype; target uuid; target_name text; target_seat smallint; current_seat uuid;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or g.status<>'playing' or g.phase<>'lobby' then return jsonb_build_object('ok',false,'code','game_started');end if;
  if g.host_id<>p_profile_id then return jsonb_build_object('ok',false,'code','forbidden');end if;
  if p_seat<1 or p_seat>g.max_players then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  select p.id,p.display_name into target,target_name from public.bq_profiles p where p.name_normalized=p_name_normalized;
  if target is null then return jsonb_build_object('ok',false,'code','player_unavailable');end if;
  if target=p_profile_id then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if not exists(select 1 from public.bq_room_members where room_id=g.room_id and profile_id=target and last_seen_at>now()-interval '2 minutes') then
    return jsonb_build_object('ok',false,'code','not_room_member');end if;
  select seat into target_seat from public.bq_room_game_players where game_id=p_game_id and profile_id=target;
  select profile_id into current_seat from public.bq_room_game_players where game_id=p_game_id and seat=p_seat;
  if current_seat is not null and current_seat<>target then return jsonb_build_object('ok',false,'code','seat_taken');end if;
  if target_seat is not null then
    update public.bq_room_game_players set seat=p_seat,ready=false,last_seen_at=now() where game_id=p_game_id and profile_id=target;
  else
    insert into public.bq_room_game_players(game_id,profile_id,seat,ready,last_seen_at) values(p_game_id,target,p_seat,false,now());
    insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'join','');
  end if;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body)
    values(g.room_id,p_game_id,p_profile_id,'say',target_name||' was assigned Player '||p_seat||'.');
  return jsonb_build_object('ok',true,'name',target_name,'seat',p_seat);
end; $$;

create or replace function public.bq_game_set_comments(p_profile_id uuid,p_game_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.host_id<>p_profile_id and g.creator_id<>p_profile_id then return jsonb_build_object('ok',false,'code','forbidden');end if;
  update public.bq_room_games set comments_enabled=p_enabled where id=p_game_id;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',case when p_enabled then 'Comments are on.' else 'Comments are off.' end);
  return jsonb_build_object('ok',true,'commentsEnabled',p_enabled);
end; $$;

create or replace function public.bq_game_ready(p_profile_id uuid,p_game_id uuid,p_ready boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype;n integer;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id) then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.phase<>'lobby' or g.status<>'playing' then return jsonb_build_object('ok',false,'code','game_started');end if;
  if p_ready and g.kind in ('ludo','chess') and not exists(select 1 from public.bq_room_game_players where game_id=p_game_id and profile_id=p_profile_id and color is not null) then
    return jsonb_build_object('ok',false,'code','choose_color');end if;
  update public.bq_room_game_players set ready=p_ready,last_seen_at=now() where game_id=p_game_id and profile_id=p_profile_id;
  select count(*) into n from public.bq_room_game_players where game_id=p_game_id and ready;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',
    (select display_name from public.bq_profiles where id=p_profile_id)||case when p_ready then ' is ready.' else ' is not ready yet.' end);
  return jsonb_build_object('ok',true,'ready',p_ready,'readyCount',n);
end; $$;

create or replace function public.bq_room_comment(p_profile_id uuid,p_room_id uuid,p_game_id uuid,p_reply_to bigint,p_body text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare parent_game uuid; enabled boolean;
begin
  if not public.bq_room_can(p_profile_id,p_room_id) then return jsonb_build_object('ok',false,'code','room_unavailable');end if;
  select comments_enabled into enabled from public.bq_room_games where id=p_game_id and room_id=p_room_id for share;
  if not found then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if not enabled then return jsonb_build_object('ok',false,'code','comments_disabled');end if;
  if p_body is null or char_length(p_body)<1 or char_length(p_body)>300 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if p_reply_to is not null then
    select game_id into parent_game from public.bq_room_events where id=p_reply_to and room_id=p_room_id and kind='comment';
    if parent_game is distinct from p_game_id then return jsonb_build_object('ok',false,'code','comment_unavailable');end if;
  end if;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body,reply_to) values(p_room_id,p_game_id,p_profile_id,'comment',p_body,p_reply_to);
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.bq_word_fits_letters(p_word text,p_letters text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare remaining text:=lower(coalesce(p_letters,''));letter text;position_index integer;i integer;
begin
  if p_word is null or p_letters is null then return false;end if;
  for i in 1..length(p_word) loop
    letter:=substr(lower(p_word),i,1);position_index:=position(letter in remaining);
    if position_index=0 then return false;end if;
    remaining:=overlay(remaining placing '' from position_index for 1);
  end loop;
  return true;
end; $$;

create or replace function public.bq_game_letter_word(p_profile_id uuid,p_game_id uuid,p_word text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype;seat smallint;clean_word text;found_words jsonb;points integer;player_name text;earned jsonb;ends_at timestamptz;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  select gp.seat into seat from public.bq_room_game_players gp where gp.game_id=p_game_id and gp.profile_id=p_profile_id;
  if not found or g.kind<>'letters' or not g.synchronized or g.phase<>'playing' or seat is null then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  ends_at:=nullif(g.state->>'endsAt','')::timestamptz;
  if ends_at is null or ends_at<=now() then return jsonb_build_object('ok',false,'code','game_finished');end if;
  clean_word:=lower(btrim(coalesce(p_word,'')));
  if clean_word!~'^[a-z]{3,7}$' then return jsonb_build_object('ok',false,'code','invalid_word');end if;
  if not public.bq_word_fits_letters(clean_word,g.state->>'letters') then return jsonb_build_object('ok',false,'code','invalid_word');end if;
  if not exists(select 1 from public.bq_words where word=clean_word) then return jsonb_build_object('ok',true,'valid',false,'points',0);end if;
  found_words:=coalesce(g.state->'foundWords','[]'::jsonb);
  if exists(select 1 from jsonb_array_elements(found_words) x(value) where x.value->>'word'=clean_word) then return jsonb_build_object('ok',true,'valid',true,'alreadyFound',true,'points',0);end if;
  points:=length(clean_word);select display_name into player_name from public.bq_profiles where id=p_profile_id;
  found_words:=found_words||jsonb_build_array(jsonb_build_object('word',clean_word,'seat',seat,'points',points));
  g.state:=jsonb_set(g.state,'{foundWords}',found_words,true);
  update public.bq_room_game_players set score=score+points,last_seen_at=now() where game_id=p_game_id and profile_id=p_profile_id;
  update public.bq_room_games set state=g.state where id=p_game_id;
  earned:=public.bq_record_word(p_profile_id,clean_word);
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'sfx','correct');
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',player_name||' found '||upper(clean_word)||' and scored '||points||' points.');
  return jsonb_build_object('ok',true,'valid',true,'points',points,'alreadyFound',false,'xp',coalesce((earned->>'xp')::integer,0),'coins',coalesce((earned->>'coins')::integer,0));
end; $$;

-- Start rules for every room mode. The selected host is the only caller allowed to reveal/start the match.
create or replace function public.bq_game_start(p_profile_id uuid,p_game_id uuid,p_initial_state jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype;n integer;ids jsonb;keys jsonb;server_keys jsonb;missing_count integer;new_state jsonb;deck jsonb;players jsonb;dealer jsonb:='[]'::jsonb;draw_index integer:=0;seat_index integer;round_index integer;question_row record;option_list jsonb;yes_no_candidates jsonb:='[]'::jsonb;candidate text;colors jsonb;white_seat integer;black_seat integer;slot_count integer;pair_count integer;cards jsonb;seed_word text;letters text;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or g.host_id<>p_profile_id then return jsonb_build_object('ok',false,'code','forbidden');end if;
  if g.phase<>'lobby' or g.status<>'playing' then return jsonb_build_object('ok',false,'code','game_started');end if;
  select count(*) into n from public.bq_room_game_players where game_id=p_game_id;
  if n<g.max_players then return jsonb_build_object('ok',false,'code','waiting_for_players');end if;
  if n<>g.max_players then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  if exists(select 1 from public.bq_room_game_players where game_id=p_game_id and not ready) then return jsonb_build_object('ok',false,'code','players_not_ready');end if;
  if g.kind in ('ludo','chess') and exists(select 1 from public.bq_room_game_players where game_id=p_game_id and color is null) then return jsonb_build_object('ok',false,'code','choose_color');end if;
  if g.kind='chess' then
    select max(seat) filter(where color='white'),max(seat) filter(where color='black') into white_seat,black_seat from public.bq_room_game_players where game_id=p_game_id;
    if white_seat is null or black_seat is null or white_seat=black_seat then return jsonb_build_object('ok',false,'code','choose_color');end if;
  end if;
  if g.kind='ludo' and exists(select color from public.bq_room_game_players where game_id=p_game_id group by color having count(*)>1) then return jsonb_build_object('ok',false,'code','color_taken');end if;
  if g.kind='quiz' then
    ids:=p_initial_state->'questionIds';keys:=p_initial_state->'answerKeys';
    if p_initial_state is null or jsonb_typeof(p_initial_state)<>'object' or octet_length(p_initial_state::text)>20000 or jsonb_typeof(ids)<>'array' or jsonb_typeof(keys)<>'array' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    if jsonb_array_length(ids)<1 or jsonb_array_length(ids)>20 or jsonb_array_length(ids)<>jsonb_array_length(keys)
      or exists(select 1 from jsonb_array_elements(ids) x(value) where jsonb_typeof(x.value)<>'string' or x.value#>>'{}' !~ '^bq-en-[0-9]{4}$')
      or exists(select 1 from jsonb_array_elements(keys) x(value) where jsonb_typeof(x.value)<>'string' or char_length(x.value#>>'{}')<1 or char_length(x.value#>>'{}')>200)
      or exists(select x.value from jsonb_array_elements_text(ids) x(value) group by x.value having count(*)>1) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    select jsonb_agg(coalesce(to_jsonb(q.correct_answer),to_jsonb(keys->>(x.ordinality-1)::integer)) order by x.ordinality),count(*) filter(where q.id is null)
      into server_keys,missing_count from jsonb_array_elements_text(ids) with ordinality x(value,ordinality) left join public.bq_questions q on q.id=x.value and q.active;
    if missing_count>0 and exists(select 1 from jsonb_array_elements_text(ids) with ordinality x(value,ordinality)
      left join public.bq_questions q on q.id=x.value and q.active where q.id is null and substring(x.value from 7)::integer not between 1417 and 1916) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    if g.config->>'mode'='yesno' then
      if missing_count>0 and (jsonb_typeof(p_initial_state->'answerOptions') is distinct from 'array' or jsonb_array_length(p_initial_state->'answerOptions')<>jsonb_array_length(ids)) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
      for question_row in select value,ordinality from jsonb_array_elements_text(ids) with ordinality x(value,ordinality) loop
        select q.answers into option_list from public.bq_questions q where q.id=question_row.value and q.active;
        if not found then option_list:=p_initial_state->'answerOptions'->(question_row.ordinality-1)::integer;
          if jsonb_typeof(option_list) is distinct from 'array' or jsonb_array_length(option_list)<2 or jsonb_array_length(option_list)>4
            or exists(select 1 from jsonb_array_elements(option_list) a(value) where jsonb_typeof(a.value)<>'string' or char_length(a.value#>>'{}')<1 or char_length(a.value#>>'{}')>200)
            or not option_list @> jsonb_build_array(keys->>(question_row.ordinality-1)::integer) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
        end if;
        candidate:=option_list->>floor(random()*jsonb_array_length(option_list))::integer;yes_no_candidates:=yes_no_candidates||jsonb_build_array(candidate);
      end loop;
    end if;
    new_state:=jsonb_build_object('questionIds',ids,'answerKeys',server_keys,'currentIndex',0,'attempts','{}'::jsonb,'solvedAt',null,'questionStartedAt',now());
    if g.config->>'mode'='yesno' then new_state:=new_state||jsonb_build_object('yesNoCandidates',yes_no_candidates);end if;
  elsif g.kind='letters' then
    if p_initial_state is null or p_initial_state->>'kind'<>'letters' then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    select word into seed_word from public.bq_words where length(word) between 4 and 7 and tier<=2 order by random() limit 1;
    if seed_word is null then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    select string_agg(ch,' ' order by random()) into letters from regexp_split_to_table(seed_word,'') as chars(ch);
    letters:=replace(letters,' ','');
    new_state:=jsonb_build_object('kind','letters','letters',letters,'foundWords','[]'::jsonb,'endsAt',now()+interval '90 seconds','winner',null,'finished',false);
  elsif g.kind='soundmatch' then
    pair_count:=case g.config->>'level' when 'medium' then 8 when 'hard' then 10 else 5 end;
    if p_initial_state is null or p_initial_state->>'kind'<>'soundmatch' or jsonb_typeof(p_initial_state->'soundSlots')<>'array'
      or jsonb_array_length(p_initial_state->'soundSlots')<>pair_count then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    if exists(select 1 from jsonb_array_elements(p_initial_state->'soundSlots') x(value) where jsonb_typeof(x.value)<>'object'
      or coalesce(x.value->>'slot','') !~ '^[a-z0-9_-]{1,60}$' or char_length(coalesce(x.value->>'name','')) not between 2 and 100) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    if exists(select x.value->>'slot' from jsonb_array_elements(p_initial_state->'soundSlots') x(value) group by x.value->>'slot' having count(*)>1) then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    select jsonb_agg(jsonb_build_object('number',shuffled.card_number,'slot',shuffled.slot,'name',shuffled.name) order by shuffled.card_number) into cards from (
      select row_number() over(order by random()) as card_number,duplicated.slot,duplicated.name from (
        select x.value->>'slot' as slot,x.value->>'name' as name from jsonb_array_elements(p_initial_state->'soundSlots') x(value) cross join generate_series(1,2) as copies(copy_number)
      ) duplicated
    ) shuffled;
    new_state:=jsonb_build_object('kind','soundmatch','cards',cards,'matched','[]'::jsonb,'selected','[]'::jsonb,'visiblePair','[]'::jsonb,'turnSeat',1,'tries',0,'lastMatched',null,'resolveAt',null,'winner',null,'finished',false);
  else
    if p_initial_state is null or jsonb_typeof(p_initial_state)<>'object' or p_initial_state->>'kind'<>g.kind or octet_length(p_initial_state::text)>20000 then return jsonb_build_object('ok',false,'code','invalid_request');end if;
    if g.kind='blackjack' then
      select jsonb_agg(card order by random()) into deck from (select rank_name||suit as card from unnest(array['A','2','3','4','5','6','7','8','9','10','J','Q','K']) ranks(rank_name) cross join unnest(array['♠','♥','♦','♣']) suits(suit)) d;
      select coalesce(jsonb_agg(jsonb_build_object('seat',gp.seat,'score',0,'hand','[]'::jsonb,'stood',false,'bust',false) order by gp.seat),'[]'::jsonb) into players from public.bq_room_game_players gp where gp.game_id=p_game_id;
      for round_index in 1..2 loop for seat_index in 0..jsonb_array_length(players)-1 loop players:=jsonb_set(players,ARRAY[seat_index::text,'hand'],(players->seat_index->'hand')||jsonb_build_array(deck->>draw_index),true);draw_index:=draw_index+1;end loop;dealer:=dealer||jsonb_build_array(deck->>draw_index);draw_index:=draw_index+1;end loop;
      new_state:=jsonb_build_object('kind','blackjack','players',players,'dealer',dealer,'deck',deck,'drawAt',draw_index,'turnSeat',1,'winner',null,'finished',false);
    elsif g.kind='chess' then
      new_state:=p_initial_state||jsonb_build_object('colorSeats',jsonb_build_object('white',white_seat,'black',black_seat),'turnSeat',white_seat);
    else new_state:=p_initial_state;end if;
  end if;
  update public.bq_room_games set phase='playing',state=new_state where id=p_game_id;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',g.title||' is starting. Good luck!');
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'sfx','go');
  return jsonb_build_object('ok',true,'phase','playing');
end; $$;

create or replace function public.bq_game_sound_flip(p_profile_id uuid,p_game_id uuid,p_number smallint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.bq_room_games%rowtype;seat smallint;card jsonb;first_card jsonb;selected jsonb;matched jsonb;visible jsonb;total integer;good boolean;next_seat integer;winner integer;profile_name text;cards jsonb;
begin
  select * into g from public.bq_room_games where id=p_game_id for update;
  if not found or g.kind<>'soundmatch' or not g.synchronized or g.phase<>'playing' or g.status<>'playing' then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  select gp.seat into seat from public.bq_room_game_players gp where gp.game_id=p_game_id and gp.profile_id=p_profile_id;
  if seat is null then return jsonb_build_object('ok',false,'code','game_unavailable');end if;
  if g.state->>'resolveAt' is not null and nullif(g.state->>'resolveAt','')::timestamptz<=now() then
    if g.state->>'lastMatched'='false' then next_seat:=((g.state->>'turnSeat')::integer%g.max_players)+1;g.state:=jsonb_set(g.state,'{turnSeat}',to_jsonb(next_seat),true);end if;
    g.state:=jsonb_set(g.state,'{visiblePair}','[]'::jsonb,true);g.state:=jsonb_set(g.state,'{lastMatched}','null'::jsonb,true);g.state:=jsonb_set(g.state,'{resolveAt}','null'::jsonb,true);
    update public.bq_room_games set state=g.state where id=p_game_id;
  end if;
  if (g.state->>'turnSeat')::integer<>seat then return jsonb_build_object('ok',false,'code','not_your_turn');end if;
  if g.state->>'resolveAt' is not null then return jsonb_build_object('ok',false,'code','invalid_action');end if;
  if p_number<1 or p_number>jsonb_array_length(g.state->'cards') then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  matched:=coalesce(g.state->'matched','[]'::jsonb);
  if matched @> jsonb_build_array(p_number) then return jsonb_build_object('ok',false,'code','invalid_action');end if;
  cards:=g.state->'cards';select value into card from jsonb_array_elements(cards) x(value) where (x.value->>'number')::integer=p_number;
  if card is null then return jsonb_build_object('ok',false,'code','invalid_request');end if;
  selected:=coalesce(g.state->'selected','[]'::jsonb);profile_name:=(select display_name from public.bq_profiles where id=p_profile_id);
  if jsonb_array_length(selected)=0 then
    insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'match',card->>'slot');
    g.state:=jsonb_set(g.state,'{selected}',jsonb_build_array(p_number),true);g.state:=jsonb_set(g.state,'{visiblePair}',jsonb_build_array(p_number),true);
    update public.bq_room_games set state=g.state where id=p_game_id;
    return jsonb_build_object('ok',true,'slot',card->>'slot','soundName',card->>'name','matched',null,'turnSeat',seat);
  end if;
  if jsonb_array_length(selected)<>1 or (selected->>0)::integer=p_number then return jsonb_build_object('ok',false,'code','invalid_action');end if;
  select value into first_card from jsonb_array_elements(cards) x(value) where (x.value->>'number')::integer=(selected->>0)::integer;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'match',card->>'slot');
  good:=first_card->>'slot'=card->>'slot';matched:=case when good then matched||selected||jsonb_build_array(p_number) else matched end;
  g.state:=jsonb_set(g.state,'{selected}','[]'::jsonb,true);g.state:=jsonb_set(g.state,'{visiblePair}',selected||jsonb_build_array(p_number),true);
  g.state:=jsonb_set(g.state,'{matched}',matched,true);g.state:=jsonb_set(g.state,'{tries}',to_jsonb(coalesce((g.state->>'tries')::integer,0)+1),true);
  g.state:=jsonb_set(g.state,'{lastMatched}',to_jsonb(good),true);
  if good then update public.bq_room_game_players set score=score+1,last_seen_at=now() where game_id=p_game_id and profile_id=p_profile_id;end if;
  select count(*) into total from jsonb_array_elements(g.state->'cards');
  if jsonb_array_length(matched)=total then
    select max(score) into total from public.bq_room_game_players where game_id=p_game_id;
    select seat into winner from public.bq_room_game_players where game_id=p_game_id and score=total order by seat limit 1;
    if (select count(*) from public.bq_room_game_players where game_id=p_game_id and score=total)>1 then winner:=0;end if;
    g.state:=jsonb_set(g.state,'{winner}',to_jsonb(winner),true);g.state:=jsonb_set(g.state,'{finished}','true'::jsonb,true);g.state:=jsonb_set(g.state,'{lastMatched}','null'::jsonb,true);
    update public.bq_room_games set state=g.state,phase='finished',status='finished',finished_at=now() where id=p_game_id;
    update public.bq_room_game_players set finished=true where game_id=p_game_id;
  else
    g.state:=jsonb_set(g.state,'{resolveAt}',to_jsonb(now()+interval '2 seconds'),true);update public.bq_room_games set state=g.state where id=p_game_id;
  end if;
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'sfx',case when good then 'correct' else 'wrong' end);
  insert into public.bq_room_events(room_id,game_id,profile_id,kind,body) values(g.room_id,p_game_id,p_profile_id,'say',case when good then profile_name||' found a sound pair and scored a point.' else profile_name||' did not find a pair.' end);
  return jsonb_build_object('ok',true,'slot',card->>'slot','soundName',card->>'name','matched',good,'finished',coalesce((g.state->>'finished')::boolean,false),'turnSeat',g.state->>'turnSeat');
end; $$;

create or replace function public.bq_game_watch(p_profile_id uuid,p_game_id uuid,p_after bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
      from (select * from public.bq_room_events where game_id=p_game_id and id>coalesce(p_after,0) order by id limit 120) e join public.bq_profiles p on p.id=e.profile_id left join public.bq_room_events parent on parent.id=e.reply_to left join public.bq_profiles rp on rp.id=parent.profile_id),'[]'::jsonb));
end; $$;

revoke all on function public.bq_word_fits_letters(text,text),public.bq_game_join_seat_color(uuid,uuid,smallint,text),public.bq_game_assign_member(uuid,uuid,text,smallint),
  public.bq_game_set_comments(uuid,uuid,boolean),public.bq_game_letter_word(uuid,uuid,text),public.bq_game_sound_flip(uuid,uuid,smallint) from public,anon,authenticated;
revoke all on function public.bq_game_create(uuid,uuid,text,text,jsonb),public.bq_game_start(uuid,uuid,jsonb),public.bq_game_watch(uuid,uuid,bigint),
  public.bq_game_join_seat(uuid,uuid,smallint),public.bq_room_comment(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bq_game_create(uuid,uuid,text,text,jsonb),public.bq_game_start(uuid,uuid,jsonb),public.bq_game_watch(uuid,uuid,bigint),
  public.bq_word_fits_letters(text,text),public.bq_game_join_seat_color(uuid,uuid,smallint,text),public.bq_game_join_seat(uuid,uuid,smallint),
  public.bq_game_assign_member(uuid,uuid,text,smallint),public.bq_game_set_comments(uuid,uuid,boolean),public.bq_room_comment(uuid,uuid,uuid,bigint,text),
  public.bq_game_letter_word(uuid,uuid,text),public.bq_game_sound_flip(uuid,uuid,smallint) to service_role;

commit;
