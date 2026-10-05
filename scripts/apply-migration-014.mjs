// Applies ONLY Migration 014 (supabase/migrations/202610050014_two_letter_words.sql) through the Supabase
// Management API query endpoint. Migrations 001-013 are never sent.
//
// Usage:
//   node scripts/apply-migration-014.mjs --check   static guards only (no network, no token)
//   node scripts/apply-migration-014.mjs --apply   guards, preflight, apply if needed, verify
import { readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { SHORT_WORD_TIERS } from '../src/short-words.js';

const MIGRATION_FILE = 'supabase/migrations/202610050014_two_letter_words.sql';
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) { console.error('Usage: apply-migration-014.mjs --check | --apply'); process.exit(2); }
const summary = [];
const note = line => { console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 014::${line}` : line); summary.push(`- ${line}`); };
const writeSummary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Migration 014\n\n' + summary.join('\n') + '\n'); };
const refuse = msg => { console.error(`::error::${msg}`); summary.push(`**REFUSED:** ${msg}`); writeSummary(); process.exit(1); };
if (process.env.MIGRATION_FILE && process.env.MIGRATION_FILE !== MIGRATION_FILE) refuse(`Only ${MIGRATION_FILE} may be applied.`);
const sql = await readFile(new URL(`../${MIGRATION_FILE}`, import.meta.url), 'utf8');

// ---- Static guard: only the reviewed statements on Migration 013 objects. ------------------------
const code = sql.replace(/--[^\n]*/g, '');
const bodies = [...code.matchAll(/\$\$([\s\S]*?)\$\$/g)].map(m => m[1]);
const outside = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/'(?:[^']|'')*'/g, "''");
const statements = outside.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
const allowed = s => /^(begin|commit)$/i.test(s)
  || /^alter table public\.bq_words drop constraint if exists bq_words_word_check$/i.test(s)
  || /^alter table public\.bq_words add constraint bq_words_word_check check \(word ~ ''\)$/i.test(s)
  || /^insert into public\.bq_words\(word, tier\) select w, s\.t from \(values \(1, ''\), \(2, ''\), \(3, ''\) \) as s\(t, list\) cross join lateral unnest\(string_to_array\(s\.list, ''\)\) as w on conflict \(word\) do nothing$/i.test(s)
  || /^create or replace function public\.bq_record_word\(p_profile_id uuid, p_word text\) returns jsonb language plpgsql security definer set search_path = public, pg_temp as \$\$$/i.test(s)
  || /^revoke all on function public\.bq_record_word\(uuid, text\) from public, anon, authenticated$/i.test(s)
  || /^grant execute on function public\.bq_record_word\(uuid, text\) to service_role$/i.test(s);
for (const s of statements) if (!allowed(s)) refuse(`Statement not allowed in Migration 014: ${s.slice(0, 100)}`);
if (!sql.includes("check (word ~ '^[a-z]{2,7}$')")) refuse('The new length check must be exactly ^[a-z]{2,7}$.');
for (const b of bodies) if (/\b(drop|truncate|delete|grant|revoke|alter|create)\b/i.test(b)) refuse('The function body contains DDL or destructive SQL.');
const seeded = [...sql.matchAll(/^  \((\d), '([a-z ]*)'\),?$/gm)].map(m => m[2]);
if (seeded.length !== 3 || seeded.some((l, i) => l !== SHORT_WORD_TIERS[i])) refuse('The two-letter seed does not match src/short-words.js.');
const words = SHORT_WORD_TIERS.join(' ').split(' ');
if (!words.every(w => /^[a-z]{2}$/.test(w))) refuse('Only two-letter words may be seeded by Migration 014.');
note(`Static guard passed: ${statements.length} statements (length check 3-7 -> 2-7 on bq_words, ${words.length} two-letter words, bq_record_word 1 XP for two-letter words).`);
if (mode === '--check') { writeSummary(); process.exit(0); }

// ---- Apply. --------------------------------------------------------------------------------------
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) refuse('SUPABASE_ACCESS_TOKEN is not set.');
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
async function query(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-migration-014' }, body: JSON.stringify({ query: q }) });
  const text = await res.text();
  if (!res.ok) refuse(`Query failed with HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text || '[]');
}
const list = words.map(w => `'${w}'`).join(',');
const STATE = `select
  (select count(*) from public.bq_words where word in (${list}))::int as two_letter,
  (select count(*) from public.bq_words where length(word) >= 3)::int as longer,
  coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.bq_words'::regclass and conname = 'bq_words_word_check'), '') as length_check,
  position('length(w.word) = 2 then 1' in coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.bq_record_word(uuid,text)')), '')) > 0 as pays_two_letter,
  coalesce(not (has_function_privilege('anon', to_regprocedure('public.bq_record_word(uuid,text)'), 'execute') or has_function_privilege('authenticated', to_regprocedure('public.bq_record_word(uuid,text)'), 'execute')) and has_function_privilege('service_role', to_regprocedure('public.bq_record_word(uuid,text)'), 'execute'), false) as locked,
  (select count(*) from public.bq_word_finds)::int as finds,
  (select count(*) from public.bq_profiles)::int as profiles`;
const before = (await query(STATE))[0];
note(`Before: ${JSON.stringify(before)}`);
const done = s => s.two_letter === words.length && /\{2,7\}/.test(s.length_check) && s.pays_two_letter && s.locked;
if (done(before)) note('Already applied; nothing to do.');
else { await query(sql); note('Migration 014 executed.'); }
const after = (await query(STATE))[0];
note(`After: ${JSON.stringify(after)}`);
if (!done(after)) refuse('Verification failed: two-letter words, length check, payout, or function privileges are not as expected.');
if (after.longer !== before.longer || after.finds < before.finds || after.profiles < before.profiles) refuse('Existing words, finds, or profiles changed; Migration 014 must only add two-letter words.');
note(`Verified: ${after.two_letter} two-letter words added, length check ${after.length_check}, bq_record_word pays 1 XP for two-letter words and is callable only by service_role; ${after.longer} existing words unchanged.`);
writeSummary();
