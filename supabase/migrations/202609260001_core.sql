-- Blind Quiz v1 core schema. All sensitive reads/writes are restricted to Edge Functions.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.bq_answers_are_unique(value jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) = 4
    and (select count(distinct item) = 4 from jsonb_array_elements_text(value) as t(item))
$$;

create table if not exists public.bq_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  name_normalized text not null unique,
  login_id text not null unique check (login_id ~ '^[A-Z0-9]{8}$'),
  secret_question text not null,
  answer_salt text not null,
  answer_hash text not null,
  xp bigint not null default 0 check (xp >= 0),
  coins bigint not null default 0 check (coins >= 0),
  level integer not null default 1 check (level >= 1),
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  questions_answered bigint not null default 0 check (questions_answered >= 0),
  questions_correct bigint not null default 0 check (questions_correct >= 0),
  quizzes_completed bigint not null default 0 check (quizzes_completed >= 0),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bq_profiles_score_idx on public.bq_profiles (xp desc, level desc);

create table if not exists public.bq_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bq_sessions_profile_idx on public.bq_sessions(profile_id, expires_at desc);

create table if not exists public.bq_questions (
  id text primary key,
  category text not null,
  subcategory text not null default '',
  difficulty text not null check (difficulty in ('easy','medium','hard','expert')),
  mode text not null default 'classic',
  question text not null,
  answers jsonb not null check (jsonb_typeof(answers)='array' and jsonb_array_length(answers)=4),
  correct_answer text not null,
  explanation text not null default '',
  xp_reward integer not null default 5 check (xp_reward between 0 and 50),
  coin_reward integer not null default 1 check (coin_reward between 0 and 20),
  tags text[] not null default '{}',
  language text not null default 'en',
  active boolean not null default true,
  source_note text not null default '',
  created_at timestamptz not null default now(),
  check (answers @> jsonb_build_array(correct_answer)),
  check (public.bq_answers_are_unique(answers))
);
create index if not exists bq_questions_lookup_idx on public.bq_questions(category, difficulty, active);

create table if not exists public.bq_answer_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.bq_profiles(id) on delete cascade,
  question_id text not null references public.bq_questions(id),
  correct boolean not null,
  xp_delta integer not null default 0,
  coins_delta integer not null default 0,
  created_at timestamptz not null default now(),
  request_id uuid not null unique default gen_random_uuid(),
  unique(profile_id,question_id)
);
create index if not exists bq_answer_events_profile_idx on public.bq_answer_events(profile_id,created_at desc);

create table if not exists public.bq_rate_limits (
  bucket text primary key,
  window_started timestamptz not null,
  attempts integer not null default 0,
  blocked_until timestamptz
);

create table if not exists public.bq_question_reports (
  id bigint generated always as identity primary key,
  profile_id uuid references public.bq_profiles(id) on delete set null,
  question_id text not null references public.bq_questions(id),
  reason text not null check (reason in ('incorrect','ambiguous','language','duplicate','inappropriate','other')),
  details text not null default '',
  created_at timestamptz not null default now()
);

-- Atomic attempt bucket; the caller supplies a one-way server-generated bucket key.
create or replace function public.bq_consume_attempt(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare current_row public.bq_rate_limits%rowtype;
begin
  insert into public.bq_rate_limits(bucket,window_started,attempts)
  values (p_bucket,now(),1)
  on conflict (bucket) do update set
    window_started = case when public.bq_rate_limits.window_started < now() - make_interval(secs => p_window_seconds) then now() else public.bq_rate_limits.window_started end,
    attempts = case when public.bq_rate_limits.window_started < now() - make_interval(secs => p_window_seconds) then 1 else public.bq_rate_limits.attempts + 1 end,
    blocked_until = case when public.bq_rate_limits.window_started < now() - make_interval(secs => p_window_seconds) then null else public.bq_rate_limits.blocked_until end
  returning * into current_row;
  return current_row.attempts <= p_limit and (current_row.blocked_until is null or current_row.blocked_until <= now());
end; $$;
revoke all on function public.bq_consume_attempt(text,integer,integer) from public, anon, authenticated;
grant execute on function public.bq_consume_attempt(text,integer,integer) to service_role;

create or replace function public.bq_record_answer(p_profile_id uuid, p_question_id text, p_choice text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.bq_questions%rowtype; p public.bq_profiles%rowtype; is_correct boolean; earned_xp integer; earned_coins integer;
begin
  select * into q from public.bq_questions where id=p_question_id and active=true;
  if not found then raise exception 'question_unavailable'; end if;
  select * into p from public.bq_profiles where id=p_profile_id for update;
  if not found then raise exception 'profile_unavailable'; end if;
  select correct into is_correct from public.bq_answer_events where profile_id=p_profile_id and question_id=p_question_id;
  if found then
    return jsonb_build_object('correct',is_correct,'answer',q.correct_answer,'explanation',q.explanation,'xp',0,'coins',0,'alreadyAnswered',true,'profile',jsonb_build_object('name',p.display_name,'xp',p.xp,'coins',p.coins,'level',p.level,'currentStreak',p.current_streak,'bestStreak',p.best_streak,'questionsAnswered',p.questions_answered,'questionsCorrect',p.questions_correct,'quizzesCompleted',p.quizzes_completed));
  end if;
  is_correct := p_choice = q.correct_answer;
  earned_xp := case when is_correct then q.xp_reward else 0 end;
  earned_coins := case when is_correct then q.coin_reward else 0 end;
  insert into public.bq_answer_events(profile_id,question_id,correct,xp_delta,coins_delta)
  values(p_profile_id,p_question_id,is_correct,earned_xp,earned_coins);
  update public.bq_profiles set
    xp=xp+earned_xp,
    coins=coins+earned_coins,
    questions_answered=questions_answered+1,
    questions_correct=questions_correct+(case when is_correct then 1 else 0 end),
    current_streak=case when is_correct then current_streak+1 else 0 end,
    best_streak=greatest(best_streak,case when is_correct then current_streak+1 else 0 end),
    level=1+((xp+earned_xp)/100)::integer,
    updated_at=now()
  where id=p_profile_id returning * into p;
  return jsonb_build_object('correct',is_correct,'answer',q.correct_answer,'explanation',q.explanation,'xp',earned_xp,'coins',earned_coins,'profile',jsonb_build_object('name',p.display_name,'xp',p.xp,'coins',p.coins,'level',p.level,'currentStreak',p.current_streak,'bestStreak',p.best_streak,'questionsAnswered',p.questions_answered,'questionsCorrect',p.questions_correct));
end; $$;
revoke all on function public.bq_record_answer(uuid,text,text) from public,anon,authenticated;
grant execute on function public.bq_record_answer(uuid,text,text) to service_role;

-- Browser clients have no direct access. Edge Functions use the server-only Supabase secret.
alter table public.bq_profiles enable row level security;
alter table public.bq_sessions enable row level security;
alter table public.bq_questions enable row level security;
alter table public.bq_answer_events enable row level security;
alter table public.bq_rate_limits enable row level security;
alter table public.bq_question_reports enable row level security;
revoke all on public.bq_profiles,public.bq_sessions,public.bq_questions,public.bq_answer_events,public.bq_rate_limits,public.bq_question_reports from anon,authenticated;
