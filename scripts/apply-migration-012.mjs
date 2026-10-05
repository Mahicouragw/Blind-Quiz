// Applies ONLY Migration 012 (supabase/migrations/202610050012_privilege_hardening.sql) through the
// Supabase Management API query endpoint. Migrations 001-011 are never sent.
//
// Usage:
//   node scripts/apply-migration-012.mjs --check   static guards only (no network, no token)
//   node scripts/apply-migration-012.mjs --apply   guards, preflight, apply if needed, verify
//
// Env for --apply: SUPABASE_ACCESS_TOKEN (never printed), PROJECT_REF (default zchircgdkyjnowqcdwvf).
import { readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';

const MIGRATION_FILE = 'supabase/migrations/202610050012_privilege_hardening.sql';
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode)) { console.error('Usage: apply-migration-012.mjs --check | --apply'); process.exit(2); }
const summary = [];
const note = line => { console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 012::${line}` : line); summary.push(`- ${line}`); };
const writeSummary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Migration 012\n\n' + summary.join('\n') + '\n'); };
const refuse = msg => { console.error(`::error::${msg}`); summary.push(`**REFUSED:** ${msg}`); writeSummary(); process.exit(1); };

if (process.env.MIGRATION_FILE && process.env.MIGRATION_FILE !== MIGRATION_FILE) refuse(`Only ${MIGRATION_FILE} may be applied.`);
const sql = await readFile(new URL(`../${MIGRATION_FILE}`, import.meta.url), 'utf8');

// ---- Static guard: privilege statements only. ----------------------------------------------------
const code = sql.replace(/--[^\n]*/g, '');
const executed = [...code.matchAll(/execute\s+'((?:[^']|'')*)'/gi)].map(m => m[1]);
const outside = code.replace(/'(?:[^']|'')*'/g, "''");
const statements = outside.replace(/do \$\$[\s\S]*?\$\$;/gi, '').split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
const allowed = s => /^(begin|commit)$/i.test(s)
  || /^revoke execute on function public\.\w+\([\w ,]*\) from [\w ,]+$/i.test(s)
  || /^grant execute on function public\.bq_answers_are_unique\(jsonb\) to service_role$/i.test(s)
  || /^alter function public\.bq_answers_are_unique\(jsonb\) set search_path = pg_catalog$/i.test(s)
  || /^alter default privileges for role (postgres|supabase_admin) in schema public revoke (all|execute) on (tables|sequences|functions) from [\w ,]+$/i.test(s);
for (const s of [...statements, ...executed.map(e => e.trim().replace(/\s+/g, ' '))]) if (!allowed(s)) refuse(`Statement not allowed in Migration 012: ${s.slice(0, 80)}`);
if (/\b(create|drop|truncate|delete|insert|update|alter table|policy)\b/i.test(outside.replace(/alter default privileges/gi, '').replace(/alter function public\.bq_answers_are_unique\(jsonb\) set search_path = pg_catalog/gi, '').replace(/do \$\$|\$\$;/g, '')) ) refuse('Migration 012 contains schema-changing or data-changing SQL.');
if (/\bgrant\b[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(code.replace(/revoke[^;']*/gi, ''))) refuse('Migration 012 must not grant anything to client roles.');
note(`Static guard passed: ${statements.length} top-level statements and ${executed.length} guarded statements, all REVOKE / service_role GRANT / ALTER DEFAULT PRIVILEGES.`);
if (mode === '--check') { writeSummary(); process.exit(0); }

// ---- Apply. --------------------------------------------------------------------------------------
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) refuse('SUPABASE_ACCESS_TOKEN is not set.');
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
async function query(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-migration-012' }, body: JSON.stringify({ query: q }) });
  const text = await res.text();
  if (!res.ok) refuse(`Query failed with HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text || '[]');
}
const STATE = `select
  coalesce((select has_function_privilege('anon', 'public.rls_auto_enable()'::regprocedure, 'execute') or has_function_privilege('authenticated', 'public.rls_auto_enable()'::regprocedure, 'execute') where to_regprocedure('public.rls_auto_enable()') is not null), false) as rls_auto_enable_client,
  has_function_privilege('anon', 'public.bq_answers_are_unique(jsonb)'::regprocedure, 'execute') or has_function_privilege('authenticated', 'public.bq_answers_are_unique(jsonb)'::regprocedure, 'execute') as answers_unique_client,
  has_function_privilege('service_role', 'public.bq_answers_are_unique(jsonb)'::regprocedure, 'execute') as answers_unique_service,
  coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = 'public.bq_answers_are_unique(jsonb)'::regprocedure), '') = 'search_path=pg_catalog' as answers_unique_pinned,
  (select count(*) from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' and pg_get_userbyid(d.defaclrole) = 'postgres' and array_to_string(d.defaclacl, ',') ~ '(^|,)(anon|authenticated)=')::int as postgres_open_defaults,
  (select count(*) from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public' and pg_get_userbyid(d.defaclrole) = 'supabase_admin' and array_to_string(d.defaclacl, ',') ~ '(^|,)(anon|authenticated)=')::int as admin_open_defaults,
  (select count(*) from public.bq_questions)::int as questions,
  (select count(*) from public.bq_profiles)::int as profiles`;
const before = (await query(STATE))[0];
note(`Before: ${JSON.stringify(before)}`);
const done = s => !s.rls_auto_enable_client && !s.answers_unique_client && s.answers_unique_service && s.answers_unique_pinned && s.postgres_open_defaults === 0;
if (done(before)) note('Already applied; nothing to do.');
else { await query(sql); note('Migration 012 executed.'); }
const after = (await query(STATE))[0];
note(`After: ${JSON.stringify(after)}`);
if (!done(after)) refuse('Verification failed: client roles still hold one of the revoked privileges.');
if (after.questions !== before.questions || after.profiles !== before.profiles) refuse('Row counts changed; Migration 012 must not touch data.');
if (after.admin_open_defaults > 0) note('supabase_admin default privileges are platform-owned and could not be changed by this session (LOW, documented).');
note('Verified: rls_auto_enable and bq_answers_are_unique are no longer client-executable; bq_answers_are_unique search_path pinned; postgres default privileges no longer grant to anon/authenticated; row counts unchanged.');
writeSummary();
