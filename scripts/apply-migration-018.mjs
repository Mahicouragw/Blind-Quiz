// Applies ONLY Migration 018 (supabase/migrations/202610060018_sound_match_rewards.sql) through the Supabase
// Management API query endpoint. Migrations 001-017 are never sent.
//
// Usage:
//   node scripts/apply-migration-018.mjs --check   static guards only (no network, no token)
//   node scripts/apply-migration-018.mjs --apply   guards, preflight, apply (idempotent), verify
import { readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';

const MIGRATION_FILE = 'supabase/migrations/202610060018_sound_match_rewards.sql';
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) { console.error('Usage: apply-migration-018.mjs --check | --apply'); process.exit(2); }
const summary = [];
const note = line => { console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 018::${line}` : line); summary.push(`- ${line}`); };
const writeSummary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Migration 018\n\n' + summary.join('\n') + '\n'); };
const refuse = msg => { console.error(`::error::${msg}`); summary.push(`**REFUSED:** ${msg}`); writeSummary(); process.exit(1); };
if (process.env.MIGRATION_FILE && process.env.MIGRATION_FILE !== MIGRATION_FILE) refuse(`Only ${MIGRATION_FILE} may be applied.`);
const sql = await readFile(new URL(`../${MIGRATION_FILE}`, import.meta.url), 'utf8');

// ---- Static guard: only additive statements on the new Sound Match objects. ---------------------
const code = sql.replace(/--[^\n]*/g, '');
const bodies = [...code.matchAll(/\$\$([\s\S]*?)\$\$/g)].map(m => m[1]);
const outside = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/'(?:[^']|'')*'/g, "''");
const statements = outside.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
const FN = '(bq_start_sound_match\\(uuid, text\\)|bq_finish_sound_match\\(uuid, uuid, integer\\))';
const ALLOWED = [
  /^begin$/i, /^commit$/i,
  /^create table if not exists public\.bq_sound_match_games \( [^;]+ \)$/i,
  /^create index if not exists bq_sound_match_games_profile_idx on public\.bq_sound_match_games \(profile_id, started_at desc\)$/i,
  /^alter table public\.bq_sound_match_games enable row level security$/i,
  /^revoke all on public\.bq_sound_match_games from public, anon, authenticated$/i,
  /^grant select, insert, update, delete on public\.bq_sound_match_games to service_role$/i,
  /^create or replace function public\.bq_start_sound_match\(p_profile_id uuid, p_level text\) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$\$$/i,
  /^create or replace function public\.bq_finish_sound_match\(p_profile_id uuid, p_game_id uuid, p_tries integer\) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$\$$/i,
  new RegExp(`^revoke all on function public\\.${FN} from public, anon, authenticated$`, 'i'),
  new RegExp(`^grant execute on function public\\.${FN} to service_role$`, 'i'),
];
for (const s of statements) if (!ALLOWED.some(r => r.test(s))) refuse(`Statement not allowed in Migration 018: ${s.slice(0, 120)}`);
if (statements.length !== 13) refuse(`Expected 13 statements, found ${statements.length}.`);
if (bodies.length !== 2) refuse('Expected exactly two function bodies.');
for (const b of bodies) if (/\b(drop|truncate|delete|grant|revoke|alter|create|execute)\b/i.test(b)) refuse('A function body contains DDL, dynamic SQL, or destructive SQL.');
if (!/references public\.bq_profiles\(id\) on delete cascade/.test(sql) || /alter table public\.bq_(profiles|questions|words|sessions)/i.test(code)) refuse('Migration 018 must only add the Sound Match table and functions.');
if (!/make_interval\(secs => g\.pairs \* 1\.5\)/.test(sql) || !/paid_today >= 40/.test(sql) || !/finished_at is not null then return/.test(sql)) refuse('The anti-cheat checks (minimum time, daily limit, single payout) must be present.');
note(`Static guard passed: ${statements.length} additive statements (bq_sound_match_games with RLS, start/finish functions callable only by service_role).`);
if (mode === '--check') { writeSummary(); process.exit(0); }

// ---- Apply. --------------------------------------------------------------------------------------
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) refuse('SUPABASE_ACCESS_TOKEN is not set.');
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
async function query(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-migration-018' }, body: JSON.stringify({ query: q }) });
  const text = await res.text();
  if (!res.ok) refuse(`Query failed with HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text || '[]');
}
const fnLocked = sig => `coalesce(not (has_function_privilege('anon', to_regprocedure('${sig}'), 'execute') or has_function_privilege('authenticated', to_regprocedure('${sig}'), 'execute')) and has_function_privilege('service_role', to_regprocedure('${sig}'), 'execute'), false)`;
const STATE = `select
  to_regclass('public.bq_sound_match_games') is not null as games_table,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bq_sound_match_games')), false) as rls,
  coalesce(not (has_table_privilege('anon', to_regclass('public.bq_sound_match_games'), 'select') or has_table_privilege('authenticated', to_regclass('public.bq_sound_match_games'), 'select')), false) as table_locked,
  ${fnLocked('public.bq_start_sound_match(uuid,text)')} and ${fnLocked('public.bq_finish_sound_match(uuid,uuid,integer)')} as functions_locked,
  to_regclass('public.bq_feedback') is not null as m017,
  (select count(*) from public.bq_profiles)::int as profiles,
  (select count(*) from public.bq_questions)::int as questions`;
const before = (await query(STATE))[0];
note(`Before: ${JSON.stringify(before)}`);
if (!before.m017) refuse('Migration 017 must be applied first.');
await query(sql);
note('Migration 018 executed (idempotent: create if not exists / create or replace).');
const after = (await query(STATE))[0];
note(`After: ${JSON.stringify(after)}`);
if (!after.games_table || !after.rls || !after.table_locked || !after.functions_locked) refuse('Verification failed: table, row level security, or privileges are not as expected.');
if (after.profiles < before.profiles || after.questions !== before.questions) refuse('Existing profiles or questions changed; Migration 018 must be additive only.');
note('Verified: Sound Match rewards are live (bq_sound_match_games with RLS; start/finish callable only by service_role).');
writeSummary();
