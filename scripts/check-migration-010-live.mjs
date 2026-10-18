// Live check that Migration 010 questions award XP and coins through the deployed
// blind-quiz-api (i.e. bq_record_answer no longer raises question_unavailable for them).
// Staging-only: uses only the public publishable key, creates a synthetic account in the
// dedicated test project required by live-test-guard.mjs, and never prints secrets.
import { randomBytes } from 'node:crypto';
import { QUESTION_BANK } from '../src/content.js';
import { requireDedicatedTestProject } from './lib/live-test-guard.mjs';

const TEST_PROJECT_URL = requireDedicatedTestProject();
const API = `${TEST_PROJECT_URL}/functions/v1/blind-quiz-api`;
const APIKEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const ORIGIN = process.env.BQ_VERIFY_ORIGIN || 'https://mahicouragw.github.io';
const out = line => console.log(process.env.GITHUB_ACTIONS ? `::notice title=Migration 010 live rewards::${line}` : line);
async function post(body, token) {
  const headers = { 'Content-Type': 'application/json', apikey: APIKEY, Origin: ORIGIN };
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
const sample = ['bq-en-0667', 'bq-en-0766', 'bq-en-0866'].map(id => QUESTION_BANK.find(q => q.id === id));
let failed = 0;
for (const q of sample) {
  const r = await post({ action: 'record-answer', questionId: q.id, choice: q.correctAnswer }, login.body.token);
  const ok = r.body?.ok === true && r.body.correct === true && Number(r.body.xp) > 0 && Number(r.body.coins) > 0 && r.body.answer === q.correctAnswer;
  if (!ok) failed++;
  out(`${ok ? 'PASS' : 'FAIL'} ${q.id} (${q.category}): status ${r.status}, code ${r.body?.code ?? 'ok'}, correct=${r.body?.correct}, xp=${r.body?.xp}, coins=${r.body?.coins}`);
}
await post({ action: 'logout' }, login.body.token);
out(`${failed ? 'FAIL' : 'PASS'}: ${sample.length - failed}/${sample.length} Migration 010 questions award XP and coins.`);
process.exit(failed ? 1 : 0);
