// Applies ONLY Migration 019 (notifications, feedback replies, presence, friends) with the shared additive guard.
//   node scripts/apply-migration-019.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '019',
  file: 'supabase/migrations/202610060019_social_notifications.sql',
  newTables: ['bq_notifications', 'bq_friendships'],
  alterTables: ['bq_profiles', 'bq_feedback'],
  functions: ['bq_relation', 'bq_touch', 'bq_online_players', 'bq_player_card', 'bq_friend_request', 'bq_friend_respond', 'bq_friend_remove', 'bq_friends', 'bq_notifications_list', 'bq_notifications_read', 'bq_set_notifications', 'bq_my_feedback', 'bq_feedback_reply', 'bq_announce'],
  deletableInBodies: ['bq_friendships'],
  requires: "to_regclass('public.bq_sound_match_games') is not null",
  verify: "select exists (select 1 from information_schema.columns where table_name = 'bq_profiles' and column_name = 'last_seen_at') as presence, exists (select 1 from information_schema.columns where table_name = 'bq_feedback' and column_name = 'reply') as replies",
  describe: 'Notifications, feedback replies, presence, friends.',
});
