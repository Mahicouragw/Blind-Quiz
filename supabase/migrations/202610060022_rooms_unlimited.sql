-- Migration 022: players may create as many rooms as they like (owner decision, 6 Oct 2026).
-- Replaces only bq_room_create from Migration 021: the five-room cap is gone. To keep the list tidy and the free
-- database small, rooms nobody has entered for 30 days are removed (default rooms never are), and one player can
-- create at most 10 rooms per hour against spam. Additive: no tables change. Requires migrations 001-021.
-- Applied only by .github/workflows/apply-migration-022.yml.
begin;
create or replace function public.bq_room_create(p_profile_id uuid, p_name text, p_public boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  if p_name is null or char_length(p_name) < 3 or char_length(p_name) > 40 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if (select count(*) from public.bq_rooms where owner_id = p_profile_id and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many_requests');
  end if;
  delete from public.bq_rooms r where not r.is_default and r.created_at < now() - interval '30 days'
    and not exists (select 1 from public.bq_room_members m where m.room_id = r.id and m.last_seen_at > now() - interval '30 days')
    and not exists (select 1 from public.bq_room_games g where g.room_id = r.id and g.created_at > now() - interval '30 days');
  insert into public.bq_rooms (name, is_public, owner_id) values (p_name, coalesce(p_public, true), p_profile_id) returning id into new_id;
  insert into public.bq_room_access (room_id, profile_id) values (new_id, p_profile_id);
  return jsonb_build_object('ok', true, 'id', new_id);
end; $$;

revoke all on function public.bq_room_create(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.bq_room_create(uuid, text, boolean) to service_role;
commit;
