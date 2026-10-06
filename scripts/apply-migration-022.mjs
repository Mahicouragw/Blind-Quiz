// Applies ONLY Migration 022 (unlimited rooms; unused rooms removed after 30 days) with the shared additive guard.
//   node scripts/apply-migration-022.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '022',
  file: 'supabase/migrations/202610060022_rooms_unlimited.sql',
  newTables: [],
  alterTables: [],
  functions: ['bq_room_create'],
  deletableInBodies: ['bq_rooms'],
  requires: "to_regclass('public.bq_rooms') is not null and to_regclass('public.bq_room_members') is not null",
  verify: "select (select count(*) from public.bq_rooms where is_default) = 3 as default_rooms_kept",
  describe: 'Unlimited rooms per player; unused rooms removed after 30 days.',
});
