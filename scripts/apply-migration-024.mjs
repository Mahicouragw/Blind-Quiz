// Applies ONLY Migration 024 (background notifications for the Android app, no Firebase) with the shared additive guard.
//   node scripts/apply-migration-024.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '024',
  file: 'supabase/migrations/202610070024_app_notifications.sql',
  newTables: ['bq_notify_tokens'],
  alterTables: [],
  functions: ['bq_notify_register', 'bq_notify_check', 'bq_notify_forget'],
  deletableInBodies: ['bq_notify_tokens'],
  requires: "to_regclass('public.bq_notifications') is not null and to_regclass('public.bq_signals') is not null",
  verify: "select to_regclass('public.bq_notify_tokens') is not null as tokens_ready, (select bool_and(position('voices' in prosrc) > 0) from pg_proc where proname = 'bq_room_state' and pronamespace = 'public'::regnamespace) as room_state_still_has_voices",
  describe: 'Background notifications for the Android app: a per-phone key that can only read the player\'s own new notifications.',
});
