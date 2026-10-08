// Applies ONLY Migration 016 (supabase/migrations/202610060016_questions_and_word_reward.sql) to the
// production database through the Supabase Management API query endpoint:
//   POST https://api.supabase.com/v1/projects/{ref}/database/query
//
// Why not `supabase db push`: the remote migration history does not match this repository, so
// the CLI would try to (re)apply migrations 001-015. Those are already applied and must never be
// recreated, rerun, or pushed. This script refuses to send anything except Migration 016:
// 250 additive question inserts plus one exact create-or-replace of bq_record_word (5 XP + 1 coin on a first find).
//
// Usage:
//   node scripts/apply-migration-016.mjs --check   static guards only (no network, no token)
//   node scripts/apply-migration-016.mjs --apply   guards, preflight, apply if needed, verify
//
// Env for --apply: SUPABASE_ACCESS_TOKEN (never printed), PROJECT_REF (default zchircgdkyjnowqcdwvf).
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { QUESTION_BANK } from '../src/content.js';

const MIGRATION_FILE = 'supabase/migrations/202610060016_questions_and_word_reward.sql';
const FIRST_ID = 'bq-en-1167';
const LAST_ID = 'bq-en-1416';
const EXPECTED_ROWS = 250;
const PER_CATEGORY = 10;
const FUNCTION_SQL = (await readFile(new URL('./migration-016-function.sql', import.meta.url), 'utf8'));
// Migration 016 must already be applied with exactly this content (verified 2026-10-05).
const MIGRATION_015_FIRST = 'bq-en-1067';
const MIGRATION_015_LAST = 'bq-en-1166';
const MIGRATION_015_ROWS = 100;
const MIGRATION_015_FINGERPRINT = '2160a37a28b0595003545a73fa9d311d';
const MIGRATION_009_FIRST = 'bq-en-0415';
const MIGRATION_009_LAST = 'bq-en-0666';
const MIGRATION_009_ROWS = 252;
// Migration 011 must already be applied with exactly this content (verified 2026-10-05).
const MIGRATION_011_FIRST = 'bq-en-0867';
const MIGRATION_011_LAST = 'bq-en-1066';
const MIGRATION_011_ROWS = 200;
const MIGRATION_011_FINGERPRINT = '5afc74d183cd824aca546e64d1264ee1';

const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) { console.error('Usage: apply-migration-016.mjs --check | --apply'); process.exit(2); }
const summary = [];
// In GitHub Actions each line is also emitted as a notice annotation, which stays readable through the
// checks API even when runner log archives cannot be downloaded.
const note = line => { console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 016::${line.replace(/^- /, '')}` : line); summary.push(line); };
const writeSummary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n'); };
const refuse = msg => { console.error(`::error::${msg}`); summary.push(`**REFUSED:** ${msg}`); writeSummary(); process.exit(1); };

// ---- Guard 1: the target is Migration 016 and nothing else. -------------------------------------
if (process.env.MIGRATION_FILE && process.env.MIGRATION_FILE !== MIGRATION_FILE) refuse(`Only ${MIGRATION_FILE} may be applied; got ${process.env.MIGRATION_FILE}.`);
const base = MIGRATION_FILE.split('/').pop();
const seq = base.match(/^\d{8}(\d{4})_/)?.[1];
if (seq !== '0016') refuse(`Target ${base} is not Migration 016.`);
const files = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
for (const f of files) {
  const n = Number(f.match(/^\d{8}(\d{4})_/)?.[1]);
  if (f !== base && n >= 1 && n <= 15) note(`- Skipping already-applied migration ${f} (001-015 are never sent).`);
}
if (!files.includes(base)) refuse(`${MIGRATION_FILE} does not exist.`);

// ---- Guard 2: apart from the reviewed function, the SQL is exactly 250 additive inserts in the 016 ID range.
const sql = await readFile(new URL(`../${MIGRATION_FILE}`, import.meta.url), 'utf8');
// The function block must be byte-identical to scripts/migration-016-function.sql and appear exactly once.
if (sql.split(FUNCTION_SQL).length !== 2) refuse('Migration 016 must contain the reviewed bq_record_word block exactly once, unchanged.');
if (!/earned_xp := 5;\n  earned_coins := 1;/.test(FUNCTION_SQL)) refuse('The bq_record_word block must pay 5 XP and 1 coin.');
const withoutFunction = sql.replace(FUNCTION_SQL, '');
const stripped = withoutFunction.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');
const statements = stripped.split(';').map(s => s.trim()).filter(Boolean);
const inserts = statements.filter(s => /^insert into public\.bq_questions\(/i.test(s));
const other = statements.filter(s => !/^insert into public\.bq_questions\(/i.test(s) && !/^(begin|commit)$/i.test(s));
if (other.length) refuse(`Migration 016 contains non-insert statements: ${other.map(s => s.slice(0, 40)).join(' | ')}`);
if (/\b(create|alter|drop|truncate|delete|grant|revoke|update\s+public)\b/i.test(stripped.replace(/on conflict \(id\) do nothing/gi, ''))) refuse('Migration 016 contains schema-changing or destructive SQL.');
if (inserts.length !== EXPECTED_ROWS) refuse(`Expected ${EXPECTED_ROWS} inserts, found ${inserts.length}.`);
if (!inserts.every(s => /on conflict \(id\) do nothing$/i.test(s))) refuse('Every Migration 016 insert must end with on conflict (id) do nothing.');
const ids = [...withoutFunction.matchAll(/values \('(bq-en-\d{4})'/g)].map(m => m[1]);
if (ids.length !== EXPECTED_ROWS || ids.some(id => id < FIRST_ID || id > LAST_ID) || new Set(ids).size !== EXPECTED_ROWS) refuse(`Migration 016 IDs must be ${EXPECTED_ROWS} unique IDs from ${FIRST_ID} to ${LAST_ID}.`);
if (/bq_record_word|create\s|function/i.test(stripped)) refuse('Only the reviewed bq_record_word block may define functions.');
if (/supabase\s+db\s+push/i.test(sql)) refuse('Migration 016 must not reference supabase db push.');

// The repo copy must match the question bank, so the fingerprint can be verified remotely.
const local = QUESTION_BANK.filter(q => q.id >= FIRST_ID && q.id <= LAST_ID).sort((a, b) => a.id < b.id ? -1 : 1);
if (local.length !== EXPECTED_ROWS || local.map(q => q.id).join() !== [...ids].sort().join()) refuse('Migration 016 is out of date with src/content.js; run npm run validate:content.');
const fingerprint = createHash('md5').update(local.map(q => `${q.id}|${q.correctAnswer}`).join('\n')).digest('hex');
note(`- Guards passed: ${base} is ${EXPECTED_ROWS} additive inserts (${FIRST_ID}..${LAST_ID}; fingerprint ${fingerprint}) plus the reviewed bq_record_word (5 XP + 1 coin).`);
if (mode === '--check') { writeSummary(); process.exit(0); }

// ---- Management API helpers. ------------------------------------------------------------------
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
if (!token) refuse('SUPABASE_ACCESS_TOKEN is not available to this workflow.');
if (!/^[a-z0-9]{20}$/.test(ref)) refuse('PROJECT_REF is not a valid Supabase project ref.');
async function query(text, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-migration-016' },
    body: JSON.stringify({ query: text }),
  });
  const body = await res.text();
  if (!res.ok) refuse(`${label} failed with HTTP ${res.status}: ${body.slice(0, 300)}`);
  try { return JSON.parse(body); } catch { return body; }
}
const stats = async label => (await query(`select
  (select count(*) from public.bq_questions)::int as total,
  (select count(*) from public.bq_questions where id between '${MIGRATION_009_FIRST}' and '${MIGRATION_009_LAST}')::int as m009,
  (select count(*) from public.bq_questions where id between '${MIGRATION_011_FIRST}' and '${MIGRATION_011_LAST}')::int as prev011,
  (select coalesce(md5(string_agg(id||'|'||correct_answer, E'\\n' order by id)),'') from public.bq_questions where id between '${MIGRATION_011_FIRST}' and '${MIGRATION_011_LAST}') as prev011_fingerprint,
  (select count(*) from public.bq_questions where id between '${MIGRATION_015_FIRST}' and '${MIGRATION_015_LAST}')::int as prev015,
  (select coalesce(md5(string_agg(id||'|'||correct_answer, E'\\n' order by id)),'') from public.bq_questions where id between '${MIGRATION_015_FIRST}' and '${MIGRATION_015_LAST}') as prev015_fingerprint,
  (select position('earned_xp := 5;' in pg_get_functiondef('public.bq_record_word(uuid,text)'::regprocedure)) > 0) as word_reward_5,
  (select count(*) from public.bq_questions where id between '${FIRST_ID}' and '${LAST_ID}')::int as m016,
  (select count(*) from public.bq_questions where id between '${FIRST_ID}' and '${LAST_ID}' and active)::int as m016_active,
  (select count(distinct category) from public.bq_questions where id between '${FIRST_ID}' and '${LAST_ID}')::int as m016_categories,
  (select coalesce(md5(string_agg(id||'|'||correct_answer, E'\\n' order by id)),'') from public.bq_questions where id between '${FIRST_ID}' and '${LAST_ID}') as m016_fingerprint`, label))[0];

// ---- Preflight: 001-015 must already be applied; 016 must be absent or already identical. ------
const before = await stats('Preflight');
note(`- Before: total=${before.total}, Migration 009 rows=${before.m009}, Migration 016 rows=${before.m016}.`);
if (before.prev011 !== MIGRATION_011_ROWS || before.prev011_fingerprint !== MIGRATION_011_FINGERPRINT) refuse(`Migration 011 must already be applied (expected ${MIGRATION_011_ROWS} matching rows, found ${before.prev011}). It is not re-run by this workflow.`);
if (before.m009 !== MIGRATION_009_ROWS) refuse(`Expected ${MIGRATION_009_ROWS} Migration 009 rows remotely, found ${before.m009}. Migration 009 is not re-run by this workflow.`);
if (before.prev015 !== MIGRATION_015_ROWS || before.prev015_fingerprint !== MIGRATION_015_FINGERPRINT) refuse(`Migration 015 must already be applied (expected ${MIGRATION_015_ROWS} matching rows, found ${before.prev015}). It is not re-run by this workflow.`);
if (before.m016 === EXPECTED_ROWS && before.m016_fingerprint === fingerprint && before.word_reward_5) {
  note('- Migration 016 is already applied with identical content. Nothing to do.');
} else if (before.m016 === EXPECTED_ROWS && before.m016_fingerprint === fingerprint) {
  // Questions present but the function is not yet updated: the whole migration is idempotent, so re-send it.
  await query(sql, 'Apply Migration 016 (function only changes)');
  note(`- Re-applied ${base}: questions were already present; bq_record_word updated.`);
} else if (before.m016 !== 0) {
  refuse(`Found ${before.m016} rows in the Migration 016 ID range that do not match this migration. Refusing to apply over them.`);
} else {
  await query(sql, 'Apply Migration 016');
  note(`- Applied ${base} through the Management API query endpoint.`);
}

// ---- Verify. ---------------------------------------------------------------------------------
const after = await stats('Verification');
const perCategory = await query(`select category, count(*)::int as n from public.bq_questions where id between '${FIRST_ID}' and '${LAST_ID}' group by category order by category`, 'Per-category verification');
note(`- After: total=${after.total}, Migration 009 rows=${after.m009}, Migration 016 rows=${after.m016} (${after.m016_active} active) in ${after.m016_categories} categories.`);
note(`- Per category: ${perCategory.map(r => `${r.category}=${r.n}`).join(', ')}`);
const problems = [];
if (after.m016 !== EXPECTED_ROWS) problems.push(`expected ${EXPECTED_ROWS} Migration 016 rows`);
if (after.m016_active !== EXPECTED_ROWS) problems.push('all Migration 016 rows must be active');
if (after.m016_categories !== 25 || perCategory.some(r => r.n !== PER_CATEGORY)) problems.push(`expected ${PER_CATEGORY} rows in each of the 25 categories`);
if (!after.word_reward_5) problems.push('bq_record_word does not pay 5 XP yet');
if (after.prev015 !== MIGRATION_015_ROWS || after.prev015_fingerprint !== MIGRATION_015_FINGERPRINT) problems.push('Migration 015 rows changed');
if (after.m016_fingerprint !== fingerprint) problems.push('remote content fingerprint does not match the repository');
if (after.m009 !== MIGRATION_009_ROWS) problems.push('Migration 009 row count changed');
if (after.prev011 !== MIGRATION_011_ROWS || after.prev011_fingerprint !== MIGRATION_011_FINGERPRINT) problems.push('Migration 011 rows changed');
if (after.total !== before.total + (before.m016 === 0 ? EXPECTED_ROWS : 0)) problems.push('total row count did not change by exactly the Migration 016 rows');
if (problems.length) refuse(`Verification failed: ${problems.join('; ')}.`);
note(`- VERIFIED: ${EXPECTED_ROWS} Migration 016 rows present and matching (fingerprint ${after.m016_fingerprint}); bq_record_word pays 5 XP + 1 coin on a first find.`);
writeSummary();
