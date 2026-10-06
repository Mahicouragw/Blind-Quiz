// Applies ONLY Migration 020 (end-to-end encrypted private messages: public keys and ciphertext only) with the shared additive guard.
//   node scripts/apply-migration-020.mjs --check | --apply
import { runGuardedMigration } from './lib/guarded-migration.mjs';
await runGuardedMigration({
  number: '020',
  file: 'supabase/migrations/202610060020_private_messages.sql',
  newTables: ['bq_devices', 'bq_messages'],
  alterTables: [],
  functions: ['bq_register_device', 'bq_message_keys', 'bq_send_message', 'bq_messages_with', 'bq_conversations'],
  deletableInBodies: [],
  requires: "to_regclass('public.bq_friendships') is not null and to_regclass('public.bq_notifications') is not null",
  verify: "select exists (select 1 from information_schema.columns where table_name = 'bq_messages' and column_name = 'boxes') as ciphertext_only, not exists (select 1 from information_schema.columns where table_name = 'bq_messages' and column_name in ('body', 'text', 'plaintext', 'message')) as no_plaintext_column",
  describe: 'End-to-end encrypted private messages (public keys and ciphertext only).',
});
