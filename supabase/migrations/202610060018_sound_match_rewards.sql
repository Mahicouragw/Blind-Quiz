-- Migration 018: XP and coins for Sound Match, verified on the server.
-- Additive only: one new table and two new functions. No existing table, row, or function changes. Requires migrations 001-017.
-- A game is registered when the board opens (bq_start_sound_match) and pays at most once when it is finished
-- (bq_finish_sound_match). The finish is refused when it is faster than the sounds allow, when the number of tries
-- is impossible, or when the game is stale. Stars are computed here. Rewards stop after 40 paid games in 24 hours.
-- Rewards: Easy 5 XP + 1 coin, Medium 10 XP + 2 coins, Hard 15 XP + 3 coins; 3 stars doubles the XP.
-- Approved by the owner on 6 Oct 2026. Applied only by .github/workflows/apply-migration-018.yml.
begin;
create table if not exists public.bq_sound_match_games (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  level text not null check (level in ('easy', 'medium', 'hard')),
  pairs integer not null check (pairs in (5, 8, 10)),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  tries integer check (tries is null or tries between 1 and 1000),
  stars integer check (stars is null or stars between 1 and 3),
  xp_delta integer not null default 0 check (xp_delta >= 0),
  coins_delta integer not null default 0 check (coins_delta >= 0)
);
create index if not exists bq_sound_match_games_profile_idx on public.bq_sound_match_games (profile_id, started_at desc);
alter table public.bq_sound_match_games enable row level security;
revoke all on public.bq_sound_match_games from public, anon, authenticated;
grant select, insert, update, delete on public.bq_sound_match_games to service_role;
create or replace function public.bq_start_sound_match(p_profile_id uuid, p_level text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g_id uuid; g_pairs integer;
begin
  g_pairs := case p_level when 'easy' then 5 when 'medium' then 8 when 'hard' then 10 else null end;
  if g_pairs is null then return jsonb_build_object('ok', false, 'code', 'invalid_level'); end if;
  insert into public.bq_sound_match_games (profile_id, level, pairs) values (p_profile_id, p_level, g_pairs) returning id into g_id;
  return jsonb_build_object('ok', true, 'gameId', g_id, 'pairs', g_pairs);
end; $$;
create or replace function public.bq_finish_sound_match(p_profile_id uuid, p_game_id uuid, p_tries integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.bq_sound_match_games%rowtype; p public.bq_profiles%rowtype; g_stars integer; earned_xp integer; earned_coins integer; paid_today integer;
begin
  select * into g from public.bq_sound_match_games where id = p_game_id and profile_id = p_profile_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'game_unavailable'); end if;
  if g.finished_at is not null then return jsonb_build_object('ok', false, 'code', 'already_finished'); end if;
  if p_tries is null or p_tries < g.pairs or p_tries > 1000 then return jsonb_build_object('ok', false, 'code', 'invalid_tries'); end if;
  if now() - g.started_at > interval '3 hours' then return jsonb_build_object('ok', false, 'code', 'game_expired'); end if;
  -- Every try plays two sounds; even a perfect memory needs about 1.5 seconds per pair.
  if now() - g.started_at < make_interval(secs => g.pairs * 1.5) then return jsonb_build_object('ok', false, 'code', 'too_fast'); end if;
  g_stars := case when p_tries <= ceil(g.pairs * 1.6) then 3 when p_tries <= g.pairs * 2.5 then 2 else 1 end;
  earned_xp := case g.level when 'easy' then 5 when 'medium' then 10 else 15 end * case when g_stars = 3 then 2 else 1 end;
  earned_coins := case g.level when 'easy' then 1 when 'medium' then 2 else 3 end;
  select count(*) into paid_today from public.bq_sound_match_games
    where profile_id = p_profile_id and finished_at > now() - interval '24 hours' and xp_delta > 0;
  if paid_today >= 40 then earned_xp := 0; earned_coins := 0; end if;
  update public.bq_sound_match_games set finished_at = now(), tries = p_tries, stars = g_stars, xp_delta = earned_xp, coins_delta = earned_coins where id = g.id;
  select * into p from public.bq_profiles where id = p_profile_id for update;
  if not found then raise exception 'profile_unavailable'; end if;
  if earned_xp > 0 or earned_coins > 0 then
    update public.bq_profiles set
      xp = xp + earned_xp,
      coins = coins + earned_coins,
      level = 1 + ((xp + earned_xp) / 100)::integer,
      updated_at = now()
    where id = p_profile_id returning * into p;
  end if;
  return jsonb_build_object('ok', true, 'stars', g_stars, 'xp', earned_xp, 'coins', earned_coins, 'dailyLimit', paid_today >= 40,
    'profile', jsonb_build_object('name', p.display_name, 'xp', p.xp, 'coins', p.coins, 'level', p.level,
      'currentStreak', p.current_streak, 'bestStreak', p.best_streak, 'questionsAnswered', p.questions_answered,
      'questionsCorrect', p.questions_correct, 'quizzesCompleted', p.quizzes_completed));
end; $$;
revoke all on function public.bq_start_sound_match(uuid, text) from public, anon, authenticated;
revoke all on function public.bq_finish_sound_match(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.bq_start_sound_match(uuid, text) to service_role;
grant execute on function public.bq_finish_sound_match(uuid, uuid, integer) to service_role;
commit;
