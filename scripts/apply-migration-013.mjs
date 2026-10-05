// Applies ONLY Migration 013 (supabase/migrations/202610050013_profile_changes_and_words.sql) through the
// Supabase Management API query endpoint. Migrations 001-012 are never sent.
//
// Usage:
//   node scripts/apply-migration-013.mjs --check   static guards only (no network, no token)
//   node scripts/apply-migration-013.mjs --apply   guards, preflight, apply if needed, verify
//
// Env for --apply: SUPABASE_ACCESS_TOKEN (never printed), PROJECT_REF (default zchircgdkyjnowqcdwvf).
import { readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { WORD_TIERS } from '../src/words.js';

const MIGRATION_FILE = 'supabase/migrations/202610050013_profile_changes_and_words.sql';
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) { console.error('Usage: apply-migration-013.mjs --check | --apply'); process.exit(2); }
const summary = [];
const note = line => { console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 013::${line}` : line); summary.push(`- ${line}`); };
const writeSummary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Migration 013\n\n' + summary.join('\n') + '\n'); };
const refuse = msg => { console.error(`::error::${msg}`); summary.push(`**REFUSED:** ${msg}`); writeSummary(); process.exit(1); };

if (process.env.MIGRATION_FILE && process.env.MIGRATION_FILE !== MIGRATION_FILE) refuse(`Only ${MIGRATION_FILE} may be applied.`);
const sql = await readFile(new URL(`../${MIGRATION_FILE}`, import.meta.url), 'utf8');

// ---- Static guard: additive statements only. -----------------------------------------------------
const code = sql.replace(/--[^\n]*/g, '');
const bodies = [...code.matchAll(/\$\$([\s\S]*?)\$\$/g)].map(m => m[1]);
const outside = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/'(?:[^']|'')*'/g, "''");
const statements = outside.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
const NEW_FUNCS = 'bq_name_cooldown_days|bq_change_name|bq_record_word', NEW_TABLES = 'bq_words|bq_word_finds';
const allowed = s => /^(begin|commit)$/i.test(s)
  || /^alter table public\.bq_profiles add column if not exists (name_change_count integer not null default 0 check \(name_change_count >= 0\)|name_changed_at timestamptz)$/i.test(s)
  || new RegExp(`^create or replace function public\\.(${NEW_FUNCS})\\(`, 'i').test(s)
  || new RegExp(`^create table if not exists public\\.(${NEW_TABLES}) \\(`, 'i').test(s)
  || /^insert into public\.bq_words\(word, tier\) select w, s\.t from \(values \(1, ''\), \(2, ''\), \(3, ''\) \) as s\(t, list\) cross join lateral unnest\(string_to_array\(s\.list, ''\)\) as w on conflict \(word\) do nothing$/i.test(s)
  || new RegExp(`^alter table public\\.(${NEW_TABLES}) enable row level security$`, 'i').test(s)
  || /^revoke all on public\.bq_words, public\.bq_word_finds from public, anon, authenticated$/i.test(s)
  || /^grant (select|select, insert) on public\.(bq_words|bq_word_finds) to service_role$/i.test(s)
  || new RegExp(`^revoke all on function public\\.(${NEW_FUNCS})\\([\\w ,]*\\) from public, anon, authenticated$`, 'i').test(s)
  || new RegExp(`^grant execute on function public\\.(${NEW_FUNCS})\\([\\w ,]*\\) to service_role$`, 'i').test(s);
for (const s of statements) if (!allowed(s)) refuse(`Statement not allowed in Migration 013: ${s.slice(0, 100)}`);
if (/\b(drop|truncate|delete|rename|alter column|policy)\b/i.test(outside.replace(/references public\.bq_profiles\(id\) on delete cascade/i, ''))) refuse('Migration 013 contains a destructive or policy statement.');
for (const b of bodies) if (/\b(drop|truncate|delete|grant|revoke|alter|create)\b/i.test(b)) refuse('A function body in Migration 013 contains DDL or destructive SQL.');
if (/\bgrant\b[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(outside)) refuse('Migration 013 must not grant anything to client roles.');
const seeded = [...sql.matchAll(/^  \((\d), '([a-z ]*)'\),?$/gm)].map(m => m[2]);
if (seeded.length !== 3 || seeded.some((list, i) => list !== WORD_TIERS[i])) refuse('The bq_words seed does not match src/words.js (run scripts/words/build-words.mjs).');
const expectedWords = new Set(WORD_TIERS.join(' ').split(' ')).size;
note(`Static guard passed: ${statements.length} additive statements (2 new columns, 2 new tables, 3 new functions, ${expectedWords} dictionary words); nothing dropped, renamed, or rewritten.`);
if (mode === '--check') { writeSummary(); process.exit(0); }

// ---- Apply. --------------------------------------------------------------------------------------
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) refuse('SUPABASE_ACCESS_TOKEN is not set.');
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
async function query(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-migration-013' }, body: JSON.stringify({ query: q }) });
  const text = await res.text();
  if (!res.ok) refuse(`Query failed with HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text || '[]');
}
// to_regprocedure() returns NULL for a missing function (a ::regprocedure cast would error before the apply).
const fn = sig => `coalesce(not (has_function_privilege('anon', to_regprocedure('${sig}'), 'execute') or has_function_privilege('authenticated', to_regprocedure('${sig}'), 'execute')) and has_function_privilege('service_role', to_regprocedure('${sig}'), 'execute'), false)`;
const STATE = `select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bq_profiles' and column_name in ('name_change_count', 'name_changed_at'))::int as new_columns,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bq_words')), false) as words_rls,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.bq_word_finds')), false) as finds_rls,
  ${fn('public.bq_change_name(uuid,text,text)')} as change_name_locked,
  ${fn('public.bq_record_word(uuid,text)')} as record_word_locked,
  ${fn('public.bq_name_cooldown_days(integer)')} as cooldown_locked,
  to_regclass('public.bq_words') is not null as words_table,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('bq_words', 'bq_word_finds') and grantee in ('anon', 'authenticated', 'PUBLIC'))::int as client_grants,
  (select count(*) from public.bq_questions)::int as questions,
  (select count(*) from public.bq_profiles)::int as profiles`;
// A query that names a missing table fails while being parsed, so the words are counted only once the table exists.
const state = async () => { const s = (await query(STATE))[0]; s.words = s.words_table ? (await query('select count(*)::int as n from public.bq_words'))[0].n : 0; return s; };
const before = await state();
note(`Before: ${JSON.stringify(before)}`);
const done = s => s.new_columns === 2 && s.words_rls && s.finds_rls && s.change_name_locked && s.record_word_locked && s.cooldown_locked && s.words === expectedWords && s.client_grants === 0;
if (done(before)) note('Already applied; nothing to do.');
else { await query(sql); note('Migration 013 executed.'); }
const after = await state();
note(`After: ${JSON.stringify(after)}`);
if (!done(after)) refuse('Verification failed: columns, tables, RLS, function privileges, or the word count are not as expected.');
// Sign-ups can happen while this runs (the live checks create a test account), so profiles may only grow.
if (after.questions !== before.questions || after.profiles < before.profiles) refuse('Questions changed or profiles were removed; Migration 013 must not touch existing rows.');
const changed = (await query(`select count(*)::int as n from public.bq_profiles where name_change_count <> 0 or name_changed_at is not null`))[0].n;
note(`Verified: 2 new profile columns, bq_words (${after.words} words) and bq_word_finds with RLS and no client grants, 3 functions callable only by service_role, row counts unchanged. Profiles with a recorded username change: ${changed}.`);
writeSummary();
