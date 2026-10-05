// Read-only production security audit for Blind Quiz.
//
// 1. Catalog review through the Supabase Management API query endpoint (SELECT-only queries):
//    RLS state, policies, table/column grants to anon/authenticated, executable functions,
//    SECURITY DEFINER functions, storage buckets, extra schemas exposed to the API.
// 2. Supabase security advisor lints and deployed Edge Function list.
// 3. Attacker probes with ONLY the public publishable key (what anyone can extract from the
//    website or APK): PostgREST table reads, write attempts designed to fail harmlessly,
//    RPC calls, GraphQL introspection, and Edge Function abuse cases.
//
// Never prints tokens, keys, password hashes, or user rows. Findings are emitted as
// annotations because runner log archives are not always downloadable.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/config.js';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
const GH = !!process.env.GITHUB_ACTIONS;
const findings = [];
const info = (title, msg) => console.log(GH ? `::notice title=${title}::${msg}` : `[info] ${title}: ${msg}`);
const finding = (sev, title, msg) => { findings.push({ sev, title, msg }); console.log(GH ? `::${sev === 'HIGH' || sev === 'CRITICAL' ? 'error' : 'warning'} title=${sev} ${title}::${msg}` : `[${sev}] ${title}: ${msg}`); };

async function mgmt(path, init = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-security-audit', ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
async function sql(query) {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('audit queries must be read-only');
  const r = await mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
  if (r.status >= 300) throw new Error(`query failed HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

// ---------------------------------------------------------------- 1. Catalog review
if (token) {
  const tables = await sql(`select n.nspname as schema, c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
      (select count(*) from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname)::int as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p','v','m') and n.nspname='public' order by 2`);
  info('Public relations', tables.map(t => `${t.name}(rls=${t.rls},policies=${t.policies})`).join(', '));
  for (const t of tables) if (!t.rls) finding('HIGH', 'RLS disabled', `public.${t.name} has row level security disabled`);

  const policies = await sql(`select tablename, policyname, cmd, roles::text as roles, coalesce(qual,'') as qual, coalesce(with_check,'') as with_check from pg_policies where schemaname='public' order by 1,2`);
  for (const p of policies) {
    info('Policy', `${p.tablename}.${p.policyname} ${p.cmd} roles=${p.roles} using=(${p.qual.slice(0, 80)}) check=(${p.with_check.slice(0, 80)})`);
    if (/anon|public|authenticated/.test(p.roles) && (p.qual === 'true' || p.with_check === 'true')) finding('HIGH', 'Permissive policy', `${p.tablename}.${p.policyname} allows ${p.cmd} for ${p.roles} with a 'true' condition`);
  }

  const grants = await sql(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','PUBLIC') group by 1,2 order by 1,2`);
  if (!grants.length) info('Table grants', 'anon/authenticated have no table privileges in public');
  for (const g of grants) finding('MEDIUM', 'Table grant to client role', `${g.grantee} has ${g.privs} on public.${g.table_name}`);

  const colGrants = await sql(`select table_name, grantee, count(*)::int as cols from information_schema.column_privileges where table_schema='public' and grantee in ('anon','authenticated') group by 1,2`);
  for (const g of colGrants) finding('MEDIUM', 'Column grant to client role', `${g.grantee} has column privileges on ${g.cols} columns of public.${g.table_name}`);

  const funcs = await sql(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
      coalesce(array_to_string(p.proconfig, ','), '') as config
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`);
  for (const f of funcs) {
    info('Function', `${f.name}(${f.args}) definer=${f.definer} anon=${f.anon_exec} authenticated=${f.auth_exec} config=${f.config || '-'}`);
    if (f.definer && (f.anon_exec || f.auth_exec)) finding('HIGH', 'Client-executable SECURITY DEFINER function', `public.${f.name}(${f.args}) can be called by anon/authenticated through the API`);
    if (f.definer && !/search_path/.test(f.config)) finding('MEDIUM', 'SECURITY DEFINER without search_path', `public.${f.name} has no fixed search_path`);
    if (!f.definer && (f.anon_exec || f.auth_exec)) finding('LOW', 'Client-executable function', `public.${f.name}(${f.args}) is executable by anon/authenticated (runs with caller rights)`);
  }

  const defaults = await sql(`select defaclobjtype as type, array_to_string(defaclacl, ',') as acl from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public'`);
  for (const d of defaults) if (/(^|,)(anon|authenticated)=/.test(d.acl)) finding('LOW', 'Default privileges', `new public objects of type ${d.type} are granted to client roles by default (${d.acl.replace(/\/\w+/g, '')})`);

  const counts = await sql(`select (select count(*) from public.bq_profiles)::int as profiles,
      (select count(*) from public.bq_sessions where revoked_at is null and expires_at > now())::int as live_sessions,
      (select count(*) from public.bq_sessions where expires_at <= now() or revoked_at is not null)::int as dead_sessions,
      (select count(*) from public.bq_rate_limits)::int as rate_buckets,
      (select count(*) from public.bq_question_reports)::int as reports`);
  info('Row counts', JSON.stringify(counts[0]));

  const buckets = await sql(`select id, public from storage.buckets`).catch(() => []);
  info('Storage buckets', buckets.length ? buckets.map(b => `${b.id}(public=${b.public})`).join(', ') : 'none');
  for (const b of buckets) if (b.public) finding('MEDIUM', 'Public storage bucket', `bucket ${b.id} is public`);

  const authUsers = await sql(`select count(*)::int as n from auth.users`).catch(() => [{ n: 'n/a' }]);
  info('Supabase Auth users', String(authUsers[0].n));

  const exposed = await mgmt('/postgrest');
  if (exposed.status === 200) info('PostgREST exposed schemas', String(exposed.body.db_schema));

  const authCfg = await mgmt('/config/auth');
  if (authCfg.status === 200) {
    const a = authCfg.body;
    info('Supabase Auth config', `disable_signup=${a.disable_signup} email=${a.external_email_enabled} phone=${a.external_phone_enabled} anonymous=${a.external_anonymous_users_enabled}`);
    if (!a.disable_signup && (a.external_email_enabled || a.external_anonymous_users_enabled)) finding('LOW', 'Unused Supabase Auth signups open', 'the app does not use Supabase Auth, but open signups let anyone obtain an authenticated role JWT');
  }

  const fnList = await mgmt('/functions');
  if (fnList.status === 200) info('Deployed Edge Functions', fnList.body.map(f => `${f.slug}(verify_jwt=${f.verify_jwt},v${f.version})`).join(', '));

  const advisors = await mgmt('/advisors/security');
  if (advisors.status === 200) {
    const lints = advisors.body.lints || [];
    info('Security advisor', `${lints.length} lint(s)`);
    for (const l of lints) finding(l.level === 'ERROR' ? 'HIGH' : l.level === 'WARN' ? 'MEDIUM' : 'LOW', `Advisor ${l.name}`, `${l.title}: ${(l.detail || '').slice(0, 200)}`);
  } else info('Security advisor', `HTTP ${advisors.status}`);
} else {
  info('Catalog review', 'skipped (no SUPABASE_ACCESS_TOKEN)');
}

// ---------------------------------------------------------------- 2. Attacker probes (public key only)
const rest = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};
const tablesToProbe = ['bq_profiles', 'bq_sessions', 'bq_questions', 'bq_answer_events', 'bq_rate_limits', 'bq_question_reports'];
for (const t of tablesToProbe) {
  const r = await rest(`/rest/v1/${t}?select=*&limit=1`);
  const rows = Array.isArray(r.body) ? r.body.length : 0;
  if (r.status === 200 && rows > 0) finding('CRITICAL', 'Anonymous table read', `GET /rest/v1/${t} returned rows with the public key`);
  else if (r.status === 200) finding('LOW', 'Anonymous table visible', `GET /rest/v1/${t} is permitted (0 rows visible)`);
  else info('Anon read blocked', `${t}: HTTP ${r.status} ${typeof r.body === 'object' ? r.body.code || '' : ''}`);
}
// Write attempts that would violate constraints even if permitted, so nothing can be stored.
const writes = [
  ['bq_profiles', { login_id: 'x' }],
  ['bq_answer_events', { profile_id: '00000000-0000-0000-0000-000000000000', question_id: '__nope__', correct: true }],
  ['bq_question_reports', { question_id: '__nope__', reason: 'not-a-reason' }],
];
for (const [t, row] of writes) {
  const r = await rest(`/rest/v1/${t}`, { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } });
  const code = typeof r.body === 'object' ? r.body.code : '';
  if (r.status === 401 || r.status === 403 || code === '42501') info('Anon write blocked', `${t}: HTTP ${r.status} ${code}`);
  else finding('HIGH', 'Anonymous write reached the table', `POST /rest/v1/${t} got HTTP ${r.status} ${code} (constraint, not permission, stopped it)`);
}
for (const t of ['bq_profiles', 'bq_sessions']) {
  const u = await rest(`/rest/v1/${t}?id=eq.00000000-0000-0000-0000-000000000000`, { method: 'PATCH', body: JSON.stringify({ revoked_at: null }) });
  const d = await rest(`/rest/v1/${t}?id=eq.00000000-0000-0000-0000-000000000000`, { method: 'DELETE' });
  for (const [verb, r] of [['PATCH', u], ['DELETE', d]]) {
    const code = typeof r.body === 'object' ? r.body.code : '';
    if (r.status === 401 || r.status === 403 || code === '42501') info('Anon update/delete blocked', `${verb} ${t}: HTTP ${r.status} ${code}`);
    else finding('HIGH', 'Anonymous update/delete permitted', `${verb} /rest/v1/${t} got HTTP ${r.status} ${code}`);
  }
}
const rpcs = [
  ['bq_record_answer', { p_profile_id: '00000000-0000-0000-0000-000000000000', p_question_id: '__nope__', p_choice: 'x' }],
  ['bq_consume_attempt', { p_bucket: 'audit-probe', p_limit: 0, p_window_seconds: 1 }],
];
for (const [fn, args] of rpcs) {
  const r = await rest(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const code = typeof r.body === 'object' ? r.body.code : '';
  if (r.status === 401 || r.status === 403 || r.status === 404 || code === '42501' || code === 'PGRST202') info('Anon RPC blocked', `${fn}: HTTP ${r.status} ${code}`);
  else finding('CRITICAL', 'Anonymous RPC call executed', `rpc/${fn} got HTTP ${r.status} ${code}`);
}
const gql = await rest('/graphql/v1', { method: 'POST', body: JSON.stringify({ query: '{ __schema { queryType { fields { name } } } }' }) });
const gqlFields = gql.body?.data?.__schema?.queryType?.fields?.map(f => f.name).filter(n => /bq_/i.test(n)) || [];
if (gqlFields.length) finding('MEDIUM', 'GraphQL exposes tables', `pg_graphql lists: ${gqlFields.join(', ')}`);
else info('GraphQL', `HTTP ${gql.status}; no bq_ tables exposed to anon`);

// Edge Function abuse cases.
const API = `${SUPABASE_URL}/functions/v1/blind-quiz-api`;
const fn = async (body, headers = {}) => {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, Origin: 'https://mahicouragw.github.io', ...headers }, body: JSON.stringify(body) });
  let b = null; try { b = await res.json(); } catch {}
  return { status: res.status, body: b, headers: res.headers };
};
const evil = await fn({ action: 'check-name', name: 'audit probe' }, { Origin: 'https://evil.example' });
if (evil.status === 403) info('CORS', 'foreign origin rejected (403)'); else finding('MEDIUM', 'Foreign origin accepted', `HTTP ${evil.status}`);
const forged = await fn({ action: 'profile' }, { Authorization: 'Bearer ' + 'A'.repeat(43) });
if (forged.status === 401) info('Forged session', 'rejected (401)'); else finding('HIGH', 'Forged session accepted', `HTTP ${forged.status}`);
const noSession = await fn({ action: 'record-answer', questionId: 'bq-en-0001', choice: 'African elephant' });
if (noSession.status === 401) info('Unauthenticated answer', 'rejected (401)'); else finding('HIGH', 'Unauthenticated answer accepted', `HTTP ${noSession.status}`);
const idor = await fn({ action: 'record-answer', questionId: 'bq-en-0001', choice: 'x', profileId: '00000000-0000-0000-0000-000000000000', p_profile_id: '00000000-0000-0000-0000-000000000000' });
if (idor.status === 401) info('IDOR via body profile id', 'ignored; session required (401)'); else finding('HIGH', 'IDOR', `HTTP ${idor.status}`);
const hdr = noSession.headers;
info('Function response headers', `cache-control=${hdr.get('cache-control')} acao=${hdr.get('access-control-allow-origin')}`);

// ---------------------------------------------------------------- Summary
const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const tally = order.map(s => `${s}=${findings.filter(f => f.sev === s).length}`).join(' ');
info('Audit summary', tally);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Security audit\n\n${tally}\n\n${findings.map(f => `- **${f.sev}** ${f.title}: ${f.msg}`).join('\n')}\n`);
}
process.exit(findings.some(f => f.sev === 'CRITICAL' || f.sev === 'HIGH') ? 1 : 0);
