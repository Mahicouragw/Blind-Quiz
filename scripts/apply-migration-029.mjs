// Applies ONLY Migration 029 (transactional account erasure with service_role-only execution).
//   node scripts/apply-migration-029.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '029',
  file: 'supabase/migrations/202610110029_account_deletion.sql',
  newTables: [],
  alterTables: [],
  functions: ['bq_delete_account'],
  deletableInBodies: ['bq_feedback', 'bq_question_reports', 'bq_notifications', 'bq_profiles'],
  requires: "to_regclass('public.bq_profiles') is not null and to_regclass('public.bq_admins') is not null and to_regclass('public.bq_feedback') is not null and to_regclass('public.bq_question_reports') is not null and to_regclass('public.bq_notifications') is not null",
  verify: "select to_regprocedure('public.bq_delete_account(uuid)') is not null as function_ready, not has_function_privilege('anon', 'public.bq_delete_account(uuid)', 'execute') as anon_blocked, not has_function_privilege('authenticated', 'public.bq_delete_account(uuid)', 'execute') as authenticated_blocked, has_function_privilege('service_role', 'public.bq_delete_account(uuid)', 'execute') as service_role_allowed",
  describe: 'Transactional account erasure, orphaned personal-data cleanup, and last-admin protection; service_role only.',
});
