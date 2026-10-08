create or replace function public.bq_record_word(p_profile_id uuid, p_word text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.bq_profiles%rowtype; w public.bq_words%rowtype; earned_xp integer; earned_coins integer; inserted integer;
begin
  select * into w from public.bq_words where word = lower(p_word);
  if not found then return jsonb_build_object('valid', false, 'xp', 0, 'coins', 0); end if;
  select * into p from public.bq_profiles where id = p_profile_id for update;
  if not found then raise exception 'profile_unavailable'; end if;
  -- Owner rule (Task 17): 5 XP and 1 coin the first time a player finds a word, whatever its length.
  earned_xp := 5;
  earned_coins := 1;
  insert into public.bq_word_finds(profile_id, word, xp_delta, coins_delta)
  values (p_profile_id, w.word, earned_xp, earned_coins)
  on conflict (profile_id, word) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    earned_xp := 0; earned_coins := 0;
  else
    update public.bq_profiles set
      xp = xp + earned_xp,
      coins = coins + earned_coins,
      current_streak = current_streak + 1,
      best_streak = greatest(best_streak, current_streak + 1),
      level = 1 + ((xp + earned_xp) / 100)::integer,
      updated_at = now()
    where id = p_profile_id returning * into p;
  end if;
  return jsonb_build_object('valid', true, 'alreadyFound', inserted = 0, 'xp', earned_xp, 'coins', earned_coins,
    'profile', jsonb_build_object('name', p.display_name, 'xp', p.xp, 'coins', p.coins, 'level', p.level,
      'currentStreak', p.current_streak, 'bestStreak', p.best_streak, 'questionsAnswered', p.questions_answered,
      'questionsCorrect', p.questions_correct, 'quizzesCompleted', p.quizzes_completed));
end; $$;
revoke all on function public.bq_record_word(uuid, text) from public, anon, authenticated;
grant execute on function public.bq_record_word(uuid, text) to service_role;
