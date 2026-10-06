// Shared guard for additive migrations (019 onwards), applied through the Supabase Management API query endpoint.
// Static guard: every statement must be one of the additive shapes below and may only touch the tables and
// functions the migration declares. Function bodies may not contain DDL, privilege changes, or dynamic SQL, and
// may only delete from the tables listed in `deletableInBodies`. Then: preflight, apply (idempotent), verify.
import { readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function runGuardedMigration({ number, file, newTables = [], alterTables = [], functions = [], deletableInBodies = [], requires, verify, describe }) {
  const mode = process.argv[2];
  const title = `Migration ${number}`;
  if (!['--check', '--apply'].includes(mode)) { console.error(`Usage: apply-migration-${number}.mjs --check | --apply`); process.exit(2); }
  const summary = [];
  const note = line => { console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title}::${line}` : line); summary.push(`- ${line}`); };
  const writeSummary = () => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${title}\n\n${summary.join('\n')}\n`); };
  const refuse = msg => { console.error(`::error::${msg}`); summary.push(`**REFUSED:** ${msg}`); writeSummary(); process.exit(1); };
  if (process.env.MIGRATION_FILE && process.env.MIGRATION_FILE !== file) refuse(`Only ${file} may be applied.`);
  const sql = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');

  const code = sql.replace(/--[^\n]*/g, '');
  const bodies = [...code.matchAll(/\$\$([\s\S]*?)\$\$/g)].map(m => m[1]);
  const outside = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/'(?:[^']|'')*'/g, "''");
  const statements = outside.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const T = `public\\.(${[...newTables, ...alterTables].map(esc).join('|')})`;
  const NT = `public\\.(${newTables.map(esc).join('|') || '(?!)'})`;
  const F = `public\\.(${functions.map(esc).join('|')})`;
  const tableList = `${NT}(, ${NT})*`;
  const fnSig = `${F}\\([a-z\\[\\], ]*\\)`;
  const fnList = `${fnSig}(, ${fnSig})*`;
  const ALLOWED = [
    /^begin$/i, /^commit$/i,
    new RegExp(`^create table if not exists ${NT} \\( [^;]+ \\)$`, 'i'),
    new RegExp(`^alter table ${T} add column if not exists [a-z_]+ [^;]+$`, 'i'),
    new RegExp(`^create (unique )?index if not exists [a-z_]+ on ${T} \\([^;]+\\)$`, 'i'),
    new RegExp(`^alter table ${NT} enable row level security$`, 'i'),
    new RegExp(`^revoke all on ${tableList} from public, anon, authenticated$`, 'i'),
    new RegExp(`^grant select, insert, update, delete on ${tableList} to service_role$`, 'i'),
    new RegExp(`^create or replace function ${F}\\([a-z_ ,\\[\\]]*\\) returns (jsonb|text|boolean) language (plpgsql|sql)( stable)? security definer set search_path = public, pg_temp as \\$\\$$`, 'i'),
    new RegExp(`^revoke all on function ${fnList} from public, anon, authenticated$`, 'i'),
    new RegExp(`^grant execute on function ${fnList} to service_role$`, 'i'),
  ];
  for (const s of statements) if (!ALLOWED.some(r => r.test(s))) refuse(`Statement not allowed in ${title}: ${s.slice(0, 160)}`);
  if (/\b(drop|truncate)\b/i.test(outside)) refuse('DROP and TRUNCATE are never allowed.');
  const declared = [...code.matchAll(/create or replace function public\.([a-z_]+)\(/gi)].map(m => m[1]);
  if (declared.length !== functions.length || functions.some(f => !declared.includes(f))) refuse(`Declared functions (${declared.join(', ')}) do not match the reviewed list.`);
  for (const b of bodies) {
    if (/\b(drop|truncate|alter|create|grant|revoke|execute|copy)\b/i.test(b)) refuse('A function body contains DDL, privilege changes, or dynamic SQL.');
    for (const m of b.matchAll(/\bdelete\s+from\s+public\.([a-z_]+)/gi)) if (!deletableInBodies.includes(m[1])) refuse(`Function bodies may not delete from ${m[1]}.`);
    for (const m of b.matchAll(/\bupdate\s+public\.([a-z_]+)\s+set\s+([^;]*?)\s+where/gi)) {
      if (m[1] === 'bq_profiles' && /\b(answer_hash|answer_salt|login_id|name_normalized|display_name|secret_question)\b/.test(m[2])) refuse('Function bodies may not change credentials or names.');
    }
  }
  note(`Static guard passed: ${statements.length} additive statements; ${functions.length} functions, all service_role only. ${describe || ''}`);
  if (mode === '--check') { writeSummary(); return; }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) refuse('SUPABASE_ACCESS_TOKEN is not set.');
  const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
  const query = async q => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': `blind-quiz-migration-${number}` }, body: JSON.stringify({ query: q }) });
    const text = await res.text();
    if (!res.ok) refuse(`Query failed with HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text || '[]');
  };
  const locked = t => `coalesce(not (has_table_privilege('anon', to_regclass('public.${t}'), 'select') or has_table_privilege('authenticated', to_regclass('public.${t}'), 'select') or has_table_privilege('anon', to_regclass('public.${t}'), 'insert')) and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.${t}')), false), false)`;
  const fnLocked = f => `coalesce((select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${f}'), false)`;
  const STATE = `select (select count(*) from public.bq_profiles)::int as profiles, (select count(*) from public.bq_questions)::int as questions,
    ${requires ? `(${requires})` : 'true'} as prerequisite,
    ${newTables.map(t => `${locked(t)} as "t_${t}"`).join(', ') || 'true as no_tables'},
    ${functions.map(f => `${fnLocked(f)} as "f_${f}"`).join(', ')}`;
  const before = (await query(STATE))[0];
  note(`Before: profiles=${before.profiles}, questions=${before.questions}, prerequisite=${before.prerequisite}`);
  if (!before.prerequisite) refuse('The previous migration must be applied first.');
  await query(sql);
  note(`${title} executed (idempotent).`);
  const after = (await query(STATE))[0];
  const bad = Object.entries(after).filter(([k, v]) => (k.startsWith('t_') || k.startsWith('f_')) && v !== true).map(([k]) => k.slice(2));
  if (bad.length) refuse(`Not locked down or missing after apply: ${bad.join(', ')}`);
  if (after.profiles < before.profiles || after.questions !== before.questions) refuse('Existing profiles or questions changed.');
  if (verify) { const v = (await query(verify))[0]; note(`Verify: ${JSON.stringify(v)}`); if (Object.values(v).some(x => x === false)) refuse('Verification query failed.'); }
  note(`Verified: ${newTables.length} new tables with row level security, ${functions.length} functions callable only by service_role.`);
  writeSummary();
}
