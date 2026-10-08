// Applies ONLY Migration 023 (room voice messages kept 24 hours; sealed call and file-transfer signals between friends) with the shared additive guard.
//   node scripts/apply-migration-023.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '023',
  file: 'supabase/migrations/202610060023_voice_signals.sql',
  newTables: ['bq_room_voices', 'bq_signals'],
  alterTables: [],
  functions: ['bq_touch', 'bq_room_state', 'bq_room_voice_send', 'bq_room_voice_get', 'bq_signal_send', 'bq_signals_poll'],
  deletableInBodies: ['bq_room_voices', 'bq_signals'],
  requires: "to_regclass('public.bq_rooms') is not null and to_regclass('public.bq_devices') is not null",
  // The newest definitions must be live: room state lists voice messages and the heartbeat reports rings.
  verify: "select to_regclass('public.bq_room_voices') is not null and to_regclass('public.bq_signals') is not null as tables_ready, (select bool_and(position('voices' in prosrc) > 0) from pg_proc where proname = 'bq_room_state' and pronamespace = 'public'::regnamespace) as room_state_has_voices, (select bool_and(position('ring' in prosrc) > 0) from pg_proc where proname = 'bq_touch' and pronamespace = 'public'::regnamespace) as touch_has_ring",
  describe: 'Room voice messages (kept 24 hours) and sealed signals for direct file transfer and calls between friends.',
});
