// Applies ONLY Migration 021 (rooms, room chat, live room games, spectators, comments) with the shared additive guard.
//   node scripts/apply-migration-021.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '021',
  file: 'supabase/migrations/202610060021_rooms.sql',
  newTables: ['bq_rooms', 'bq_room_access', 'bq_room_members', 'bq_room_games', 'bq_room_game_players', 'bq_room_events'],
  alterTables: [],
  functions: ['bq_room_can', 'bq_rooms_list', 'bq_room_create', 'bq_room_remove', 'bq_room_state', 'bq_room_leave', 'bq_room_say', 'bq_room_invite', 'bq_match_invite', 'bq_game_create', 'bq_game_join', 'bq_game_post', 'bq_game_watch'],
  deletableInBodies: ['bq_rooms'],
  requires: "to_regclass('public.bq_messages') is not null and to_regclass('public.bq_friendships') is not null",
  verify: "select (select count(*) from public.bq_rooms where is_default and is_public) = 3 as three_public_rooms",
  describe: 'Rooms, room chat, live room games, spectators and comments.',
});
