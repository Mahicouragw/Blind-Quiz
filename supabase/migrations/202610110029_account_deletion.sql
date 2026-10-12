-- Migration 029: account deletion, called only by the authenticated blind-quiz-api Edge Function.
-- The function is executable only by service_role. It erases linked feedback/reports that otherwise
-- become orphaned by SET NULL, clears notifications where this account was the actor, then deletes
-- the profile in one transaction. Foreign-key cascades remove sessions, progress, social links,
-- encrypted messages/devices, notification tokens, and rooms owned by the account.
-- Last-admin protection and row locks keep concurrent deletions from removing every administrator.
begin;

create or replace function public.bq_delete_account(p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  -- Lock the profile first so two concurrent deletion requests cannot race its existence check.
  perform 1 from public.bq_profiles where id = p_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  -- Serialize admin deletions and preserve at least one admin even under concurrent requests.
  perform 1 from public.bq_admins where profile_id = p_profile_id for update;
  if found then
    lock table public.bq_admins in exclusive mode;
    if (select count(*) from public.bq_admins) <= 1 then
      return jsonb_build_object('ok', false, 'code', 'last_admin');
    end if;
  end if;

  -- These foreign keys use SET NULL so the rows would otherwise retain player-linked content.
  delete from public.bq_feedback where profile_id = p_profile_id;
  delete from public.bq_question_reports where profile_id = p_profile_id;
  delete from public.bq_notifications where actor_id = p_profile_id;

  delete from public.bq_profiles where id = p_profile_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.bq_delete_account(uuid) from public, anon, authenticated;
grant execute on function public.bq_delete_account(uuid) to service_role;

commit;
