// Applies ONLY Migration 030 (player safety, admin-reviewed restrictions, and shareable room-game replays).
//   node scripts/apply-migration-030.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '030',
  file: 'supabase/migrations/202610120030_player_safety_and_game_replays.sql',
  newTables: [
    'bq_player_mutes', 'bq_player_blocks', 'bq_player_reports', 'bq_account_restrictions',
    'bq_room_game_replay_steps', 'bq_room_game_replay_shares',
  ],
  alterTables: [],
  functions: [
    'bq_player_is_muted', 'bq_player_is_blocked', 'bq_player_is_hidden', 'bq_player_mute', 'bq_player_block', 'bq_player_report',
    'bq_player_card', 'bq_online_players', 'bq_friend_request', 'bq_friend_respond', 'bq_notifications_list',
    'bq_message_keys', 'bq_send_message', 'bq_messages_with', 'bq_conversations', 'bq_room_state', 'bq_room_voice_get',
    'bq_signal_send', 'bq_signals_poll', 'bq_notify_check', 'bq_game_watch', 'bq_game_invite',
    'bq_admin_player_reports', 'bq_admin_player_report_action', 'bq_room_invite', 'bq_match_invite', 'bq_room_game_replay_capture_step',
    'bq_replay_public_jsonb', 'bq_replay_public_state', 'bq_replay_attempts_by_seat',
    'bq_room_game_replay_create', 'bq_room_game_replay_read',
  ],
  deletableInBodies: [
    'bq_player_mutes', 'bq_player_blocks', 'bq_friendships', 'bq_notifications', 'bq_signals',
    'bq_notify_tokens', 'bq_account_restrictions', 'bq_room_voices', 'bq_room_game_replay_steps', 'bq_room_game_replay_shares',
  ],
  triggers: ['bq_room_game_replay_capture'],
  triggerTables: ['bq_room_games'],
  requires: "to_regclass('public.bq_profiles') is not null and to_regclass('public.bq_admins') is not null and to_regclass('public.bq_sessions') is not null and to_regclass('public.bq_friendships') is not null and to_regclass('public.bq_notifications') is not null and to_regclass('public.bq_messages') is not null and to_regclass('public.bq_devices') is not null and to_regclass('public.bq_signals') is not null and to_regclass('public.bq_notify_tokens') is not null and to_regclass('public.bq_rooms') is not null and to_regclass('public.bq_room_access') is not null and to_regclass('public.bq_room_members') is not null and to_regclass('public.bq_room_events') is not null and to_regclass('public.bq_room_voices') is not null and to_regclass('public.bq_room_games') is not null and to_regclass('public.bq_room_game_players') is not null and to_regclass('public.bq_word_finds') is not null and to_regclass('public.bq_sound_match_games') is not null", 
  verify: "select to_regclass('public.bq_player_mutes') is not null as mute_table_ready, to_regclass('public.bq_player_blocks') is not null as block_table_ready, to_regclass('public.bq_player_reports') is not null as reports_table_ready, to_regclass('public.bq_account_restrictions') is not null as restrictions_table_ready, to_regclass('public.bq_room_game_replay_steps') is not null as replay_steps_ready, to_regclass('public.bq_room_game_replay_shares') is not null as replay_shares_ready, to_regprocedure('public.bq_room_game_replay_create(uuid,uuid)') is not null as replay_create_ready, to_regprocedure('public.bq_room_game_replay_read(uuid)') is not null as replay_read_ready, exists(select 1 from pg_trigger where tgname='bq_room_game_replay_capture' and not tgisinternal) as replay_capture_ready",
  describe: 'One-way mutes, reciprocal blocks, admin-only report review with human-decided restriction, and sanitized public replay links; no automatic restrictions.',
});
