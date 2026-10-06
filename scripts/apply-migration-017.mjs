// Applies ONLY Migration 017 (supabase/migrations/202610060017_feedback_inbox.sql) through the Supabase
// Management API query endpoint. Migrations 001-016 are never sent.
//
// Usage:
//   node scripts/apply-migration-017.mjs --check   static guards only (no network, no token)
//   node scripts/apply-migration-017.mjs --apply   guards, preflight, apply if needed, verify
import { readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';

const MIGRATION_FILE = 'supabase/migrations/202610060017_feedback_inbox.sql';
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) { console.error('Usage: apply-migration-017.mjs --check | --apply'); process.exit(2); }
const summary = [];
const note = line => { console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 017::${line}` : line); summary.push(`- ${line}`); };
const writeSummary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Migration 017\n\n' + summary.join('\n') + '\n'); };
const refuse = msg => { console.error(`::error::${msg}`); summary.push(`**REFUSED:** ${msg}`); writeSummary(); process.exit(1); };
if (process.env.MIGRATION_FILE && process.env.MIGRATION_FILE !== MIGRATION_FILE) refuse(`Only ${MIGRATION_FILE} may be applied.`);
const sql = await readFile(new URL(`../${MIGRATION_FILE}`, import.meta.url), 'utf8');

// ---- Static guard: only the reviewed, additive statements. --------------------------------------
const code = sql.replace(/--[^\n]*/g, '');
// Semicolons inside quoted strings (the screenshot data-URL check) must not split statements.
const masked = code.replace(/'(?:[^']|'')*'/g, m => m.replaceAll(';', '\u0001'));
const statements = masked.split(';').map(s => s.trim().replace(/\s+/g, ' ').replaceAll('\u0001', ';')).filter(Boolean);
const ALLOWED = [
  /^begin$/i, /^commit$/i,
  /^create table if not exists public\.bq_admins \( profile_id uuid primary key references public\.bq_profiles\(id\) on delete cascade, created_at timestamptz not null default now\(\) \)$/i,
  /^create table if not exists public\.bq_feedback \( id bigint generated always as identity primary key, profile_id uuid references public\.bq_profiles\(id\) on delete set null, name text not null check \(char_length\(name\) between 2 and 40\), kind text not null check \(kind in \('feedback', 'problem', 'idea'\)\), message text not null check \(char_length\(message\) between 5 and 2000\), screenshot text check \(screenshot is null or \(char_length\(screenshot\) <= 900000 and screenshot ~ '\^data:image\/\(jpeg\|png\|webp\);base64,'\)\), has_screenshot boolean generated always as \(screenshot is not null\) stored, created_at timestamptz not null default now\(\), read_at timestamptz \)$/i,
  /^create index if not exists bq_feedback_created_idx on public\.bq_feedback \(created_at desc\)$/i,
  /^alter table public\.bq_admins enable row level security$/i,
  /^alter table public\.bq_feedback enable row level security$/i,
  /^revoke all on public\.bq_admins, public\.bq_feedback from public, anon, authenticated$/i,
  /^grant select, insert, update, delete on public\.bq_admins, public\.bq_feedback to service_role$/i,
  /^insert into public\.bq_admins \(profile_id\) select id from public\.bq_profiles where name_normalized = 'goldfish' on conflict \(profile_id\) do nothing$/i,
];
for (const s of statements) if (!ALLOWED.some(r => r.test(s))) refuse(`Statement not allowed in Migration 017: ${s.slice(0, 120)}`);
if (statements.length !== ALLOWED.length) refuse(`Expected exactly ${ALLOWED.length} statements, found ${statements.length}.`);
if (/\b(drop|truncate|delete from|alter table public\.bq_(profiles|sessions|questions|words|word_finds|answer_events|rate_limits|question_reports))\b/i.test(code)) refuse('Migration 017 must not change or remove existing objects.');
note(`Static guard passed: ${statements.length} additive statements (bq_admins, bq_feedback, RLS on, service_role only, Goldfish as admin).`);
if (mode === '--check') { writeSummary(); process.exit(0); }

// ---- Apply. --------------------------------------------------------------------------------------
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) refuse('SUPABASE_ACCESS_TOKEN is not set.');
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
async function query(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-migration-017' }, body: JSON.stringify({ query: q }) });
  const text = await res.text();
  if (!res.ok) refuse(`Query failed with HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text || '[]');
}
const locked = t => `coalesce(not (has_table_privilege('anon', to_regclass('${t}'), 'select') or has_table_privilege('authenticated', to_regclass('${t}'), 'select') or has_table_privilege('anon', to_regclass('${t}'), 'insert') or has_table_privilege('authenticated', to_regclass('${t}'), 'insert')) and has_table_privilege('service_role', to_regclass('${t}'), 'insert'), false)`;
const STATE = `select
  to_regclass('public.bq_admins') is not null as admins_table,
  to_regclass('public.bq_feedback') is not null as feedback_table,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bq_admins')), false) and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bq_feedback')), false) as rls,
  ${locked('public.bq_admins')} and ${locked('public.bq_feedback')} as locked,
  (select count(*) from public.bq_profiles where name_normalized = 'goldfish')::int as goldfish_accounts,
  (select count(*) from public.bq_profiles)::int as profiles,
  (select count(*) from public.bq_questions)::int as questions`;
const before = (await query(STATE))[0];
note(`Before: ${JSON.stringify(before)}`);
if (before.goldfish_accounts !== 1) note('WARNING: no account named Goldfish exists yet, so no admin is set. Sign up as Goldfish, then re-run this workflow.');
// The migration is idempotent (create if not exists, on conflict do nothing), so it is always sent; re-running only adds a missing admin row.
await query(sql);
note('Migration 017 executed (idempotent).');
const after = (await query(`${STATE}, (select count(*) from public.bq_admins a join public.bq_profiles p on p.id = a.profile_id where p.name_normalized = 'goldfish')::int as goldfish_admin, (select count(*) from public.bq_admins)::int as admins`))[0];
note(`After: ${JSON.stringify(after)}`);
if (!after.admins_table || !after.feedback_table || !after.rls || !after.locked) refuse('Verification failed: tables, row level security, or privileges are not as expected.');
if (after.profiles < before.profiles || after.questions !== before.questions) refuse('Existing profiles or questions changed; Migration 017 must be additive only.');
if (after.admins !== after.goldfish_admin) refuse('Only the Goldfish account may be an admin.');
note(`Verified: bq_feedback and bq_admins exist with row level security, reachable only by service_role; Goldfish admin rows: ${after.goldfish_admin}.`);
writeSummary();
