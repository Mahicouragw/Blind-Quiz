// Live check that Migration 015 questions award XP and coins through the deployed
// blind-quiz-api (i.e. bq_record_answer no longer raises question_unavailable for them).
// Read-only with respect to the function: uses only the public publishable key, creates a
// throwaway verification account, and never prints secret answers or session tokens.
import { randomBytes } from 'node:crypto';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/config.js';
import { QUESTION_BANK } from '../src/content.js';

const API = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/blind-quiz-api`;
const ORIGIN = process.env.BQ_VERIFY_ORIGIN || 'https://mahicouragw.github.io';
const out = line => console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 015 live rewards::${line}` : line);
async function post(body, token) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}
const name = `BQ Verify ${randomBytes(6).toString('hex')}`;
const question = 'What was the name of your first school?';
const answer = `verify-${randomBytes(12).toString('hex')}`;
const signup = await post({ action: 'signup', name, question, answer });
if (signup.status !== 201 || !signup.body?.loginId) { console.error(`::error::signup failed: status ${signup.status}, code ${signup.body?.code}`); process.exit(1); }
const login = await post({ action: 'login', name, loginId: signup.body.loginId, answer });
if (!login.body?.token) { console.error(`::error::login failed: status ${login.status}, code ${login.body?.code}`); process.exit(1); }
const sample = ['bq-en-1067', 'bq-en-1107', 'bq-en-1166'].map(id => QUESTION_BANK.find(q => q.id === id));
let failed = 0;
// The apply workflow may still be running when this check starts on the same push, so a
// not-yet-available question is retried for up to about four minutes before it counts as a failure.
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const q of sample) {
  let r;
  for (let attempt = 1; attempt <= 16; attempt++) {
    r = await post({ action: 'record-answer', questionId: q.id, choice: q.correctAnswer }, login.body.token);
    if (r.body?.ok === true || attempt === 16) break;
    console.log(`  ${q.id} not available yet (status ${r.status}, code ${r.body?.code}); retry ${attempt} in 15s`);
    await sleep(15000);
  }
  const ok = r.body?.ok === true && r.body.correct === true && Number(r.body.xp) > 0 && Number(r.body.coins) > 0 && r.body.answer === q.correctAnswer;
  if (!ok) failed++;
  out(`${ok ? 'PASS' : 'FAIL'} ${q.id} (${q.category}): status ${r.status}, code ${r.body?.code ?? 'ok'}, correct=${r.body?.correct}, xp=${r.body?.xp}, coins=${r.body?.coins}`);
}
await post({ action: 'logout' }, login.body.token);
out(`${failed ? 'FAIL' : 'PASS'}: ${sample.length - failed}/${sample.length} Migration 015 questions award XP and coins.`);
process.exit(failed ? 1 : 0);
