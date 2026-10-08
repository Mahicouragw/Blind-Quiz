-- Migration 012: privilege hardening found by the Task 9 security audit.
-- Additive and privilege-only (REVOKE, plus a pinned search_path): no table, column, row, policy, or function body is created, changed,
-- or dropped. Migrations 001-011 are untouched. Safe to run more than once.
--
-- 1. public.rls_auto_enable() is a SECURITY DEFINER event-trigger helper that was executable by
--    anon/authenticated through the API (Supabase advisor). Event triggers do not need EXECUTE
--    grants on their function, so revoking client access does not change its behaviour.
-- 2. public.bq_answers_are_unique(jsonb) (used by a bq_questions CHECK constraint) was executable
--    by anon/authenticated through PUBLIC. Only the table owner and service_role need it.
--    Its search_path is also pinned to pg_catalog (it only uses built-in jsonb functions), which
--    resolves the advisor's function_search_path_mutable warning without changing its body.
-- 3. Default privileges: objects created later in schema public must not be granted to the client
--    roles automatically. The app only reaches the database through the Edge Function (service_role).
begin;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

revoke execute on function public.bq_answers_are_unique(jsonb) from public, anon, authenticated;
grant execute on function public.bq_answers_are_unique(jsonb) to service_role;
alter function public.bq_answers_are_unique(jsonb) set search_path = pg_catalog;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- Platform-owned defaults can only be changed when the session is allowed to act for supabase_admin.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public';
exception when insufficient_privilege then
  raise notice 'supabase_admin default privileges left unchanged (insufficient privilege)';
end $$;

commit;
