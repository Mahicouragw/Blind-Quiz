-- Migration 014: two-letter words for Letters to Words (owner-approved on 5 Oct 2026).
--
-- Touches only objects created by Migration 013: the bq_words length check is widened from 3-7 to 2-7 letters,
-- the hand-picked two-letter words from src/short-words.js are added, and bq_record_word pays 1 XP + 1 coin for a
-- two-letter word (unchanged for longer words). No existing row is changed or removed; migrations 001-013 are
-- untouched. Safe to run more than once.
begin;

alter table public.bq_words drop constraint if exists bq_words_word_check;
alter table public.bq_words add constraint bq_words_word_check check (word ~ '^[a-z]{2,7}$');

insert into public.bq_words(word, tier)
select w, s.t from (values
  (1, 'am an as at be by do go he if in is it me my no of oh on or so to up us we'),
  (2, 'ah ha hi ox'),
  (3, 'ad ma pa')
) as s(t, list) cross join lateral unnest(string_to_array(s.list, ' ')) as w
on conflict (word) do nothing;

-- Same function as in Migration 013, except a two-letter word pays 1 XP (3+ letters: 2-6 XP by length).
create or replace function public.bq_record_word(p_profile_id uuid, p_word text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.bq_profiles%rowtype; w public.bq_words%rowtype; earned_xp integer; earned_coins integer; inserted integer;
begin
  select * into w from public.bq_words where word = lower(p_word);
  if not found then return jsonb_build_object('valid', false, 'xp', 0, 'coins', 0); end if;
  select * into p from public.bq_profiles where id = p_profile_id for update;
  if not found then raise exception 'profile_unavailable'; end if;
  earned_xp := case when length(w.word) = 2 then 1 else least(6, greatest(2, length(w.word) - 1)) end;
  earned_coins := case when length(w.word) >= 5 then 2 else 1 end;
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

commit;
