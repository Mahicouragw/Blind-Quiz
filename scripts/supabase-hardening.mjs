// One-time, owner-approved Supabase project hardening (Task 9), idempotent:
//   1. Disable Supabase Auth signups. The app never uses Supabase Auth (it has its own Login ID
//      accounts in the Edge Function); open signups only let strangers mint "authenticated" JWTs.
//   2. Delete the unused, unreviewed Edge Function "smooth-processor" (not in this repository).
//      Its metadata is recorded first. blind-quiz-api can never be targeted by this script.
// Prints only non-secret metadata. Env: SUPABASE_ACCESS_TOKEN (never printed), PROJECT_REF.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/config.js';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.PROJECT_REF || 'zchircgdkyjnowqcdwvf';
const UNUSED_FUNCTION = 'smooth-processor';
const PROTECTED = new Set(['blind-quiz-api']);
const note = (t, m) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=${t}::${m}` : `${t}: ${m}`);
const fail = m => { console.log(`::error::${m}`); process.exit(1); };
if (!token) fail('SUPABASE_ACCESS_TOKEN is not set.');
if (PROTECTED.has(UNUSED_FUNCTION)) fail('Refusing to delete a protected function.');
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'blind-quiz-hardening', ...(init.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

// ---- 1. Supabase Auth signups ---------------------------------------------------------------------
let auth = await api('/config/auth');
if (auth.status !== 200) fail(`Could not read auth config (HTTP ${auth.status}).`);
note('Auth before', `disable_signup=${auth.body.disable_signup}`);
if (!auth.body.disable_signup) {
  const r = await api('/config/auth', { method: 'PATCH', body: JSON.stringify({ disable_signup: true }) });
  if (r.status >= 300) fail(`Could not disable signups (HTTP ${r.status}).`);
  auth = await api('/config/auth');
}
if (auth.body.disable_signup !== true) fail('Auth signups are still enabled.');
note('Auth after', 'disable_signup=true (Supabase Auth signups closed; Blind Quiz accounts are unaffected)');

// ---- 2. Unused Edge Function ----------------------------------------------------------------------
const meta = await api(`/functions/${UNUSED_FUNCTION}`);
if (meta.status === 404) note('Unused function', `${UNUSED_FUNCTION} is not deployed (already removed)`);
else if (meta.status === 200) {
  const m = meta.body;
  note('Unused function metadata', `slug=${m.slug} name=${m.name} version=${m.version} status=${m.status} verify_jwt=${m.verify_jwt} entrypoint=${m.entrypoint_path || '-'} created=${m.created_at} updated=${m.updated_at}`);
  const probe = await fetch(`${SUPABASE_URL}/functions/v1/${UNUSED_FUNCTION}`, { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
  note('Unused function anonymous probe', probe ? `HTTP ${probe.status}` : 'unreachable');
  const del = await api(`/functions/${UNUSED_FUNCTION}`, { method: 'DELETE' });
  if (del.status >= 300) fail(`Delete failed (HTTP ${del.status}).`);
  const again = await api(`/functions/${UNUSED_FUNCTION}`);
  if (again.status !== 404) fail(`${UNUSED_FUNCTION} still exists (HTTP ${again.status}).`);
  note('Unused function', `${UNUSED_FUNCTION} deleted and verified gone`);
} else fail(`Could not read ${UNUSED_FUNCTION} (HTTP ${meta.status}).`);

const list = await api('/functions');
note('Remaining Edge Functions', list.status === 200 ? list.body.map(f => f.slug).join(', ') : `HTTP ${list.status}`);
if (list.status === 200 && !list.body.some(f => f.slug === 'blind-quiz-api')) fail('blind-quiz-api is missing!');
