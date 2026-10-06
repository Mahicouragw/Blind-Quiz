// Live verification for the deployed blind-quiz-api Edge Function.
//
// Scope: signup, Login ID shape, login, Login ID recovery, logout + session
// revocation, server-validated answer rewards, generic client errors, rate
// limiting, own-profile changes (username cooldown, uniqueness, secret change),
// and server-verified Letters to Words rewards.
//
// Safety rules enforced by this file:
//   * Uses only the PUBLIC publishable key that ships to browsers. It never
//     reads, requires, or accepts a service-role/secret key or rate-limit pepper.
//   * Secret answers, session tokens, and Authorization headers are generated
//     in-memory and are never written to stdout, stderr, or the exit message.
//   * Only HTTP status codes and non-sensitive response codes are reported.
//
// Run: node tests/live-api.mjs
// Optional overrides (never required): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
// BQ_VERIFY_ORIGIN, BQ_VERIFY_NAME, BQ_VERIFY_QUESTION, BQ_VERIFY_ANSWER.

import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/config.js';
import { QUESTION_BANK } from '../src/content.js';

const API = `${(process.env.SUPABASE_URL || SUPABASE_URL).replace(/\/$/, '')}/functions/v1/blind-quiz-api`;
const APIKEY = process.env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY;
const ORIGIN = process.env.BQ_VERIFY_ORIGIN || 'https://mahicouragw.github.io';
const LOGIN_ID_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/; // 8 chars from the server alphabet (no I, O, 0, 1)
const TIMEOUT_MS = 30_000;

// Values that must never appear in anything this script prints.
const secrets = new Set();
const guard = value => { if (typeof value === 'string' && value.length >= 8) secrets.add(value); return value; };

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail) {
  check(label, false, detail);
  console.log('\n--- Live API verification could not continue ---');
  summarize();
  process.exit(1);
}

const hex = n => randomBytes(n).toString('hex');
const tokenish = () => `bq${hex(6)}`;

// Test identity. Unique per run by default so no production row is reused or
// overwritten; overridable for a stable dedicated verification account.
const NAME = process.env.BQ_VERIFY_NAME || `BQ Verify ${tokenish()}`;
const QUESTION = process.env.BQ_VERIFY_QUESTION || 'What was the name of your first school?';
const ANSWER = guard(process.env.BQ_VERIFY_ANSWER || `verify-${hex(12)}`);
const WRONG_ANSWER = guard(`${ANSWER}-nope`);

async function post(body, { origin = ORIGIN, apikey = APIKEY, token, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (apikey) headers.apikey = apikey;
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method: 'POST', headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (raw !== undefined) init.body = raw; else init.body = JSON.stringify(body);
  let response;
  try {
    response = await fetch(API, init);
  } catch (error) {
    return { status: 0, body: null, text: '', transportError: error.cause?.code || error.name || 'network_error' };
  }
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON platform response */ }
  return { status: response.status, body: parsed, text, headers: response.headers };
}

// Redact before echoing anything that came back from the network.
function sanitize(text = '') {
  let out = String(text).slice(0, 240);
  for (const value of secrets) out = out.split(value).join('[redacted]');
  out = out.split(APIKEY).join('[redacted-apikey]');
  return out.replace(/\s+/g, ' ');
}

function codeOf(result) { return result.body?.code ?? (result.body?.ok === true ? 'ok' : `http_${result.status}`); }

function summarize() {
  const passed = results.filter(r => r.ok).length;
  const verdict = `${failures === 0 ? 'PASS' : 'FAIL'}: ${passed}/${results.length} live API checks passed.`;
  console.log(`\n${verdict}`);
  if (failures) console.log('Failed checks: ' + results.filter(r => !r.ok).map(r => r.name).join(', '));
  // Publish the report in CI so results are readable without log download.
  // GITHUB_STEP_SUMMARY is per-step and cannot be read by a later step, so an
  // explicit BQ_REPORT_FILE path is supported for cross-step reporting.
  const targets = [process.env.GITHUB_STEP_SUMMARY, process.env.BQ_REPORT_FILE].filter(Boolean);
  if (!targets.length) return;
  const lines = [
    `## Live Edge Function verification — ${failures === 0 ? 'PASSED' : 'FAILED'}`,
    '',
    `**${verdict}**`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...results.map(r => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${String(r.detail).replace(/\|/g, '\\|').slice(0, 120) || '—'} |`),
    '',
    'Only HTTP status codes and non-sensitive response codes are reported. Secret answers, session tokens, apikeys, and Authorization headers are never printed.',
    '',
  ];
  const report = lines.join('\n');
  for (const target of targets) {
    try { appendFileSync(target, report); } catch { /* reporting must never fail the run */ }
  }
}

console.log(`Target function host: ${new URL(API).host}`);
console.log(`Verification identity: freshly generated for this run.\n`);

// --- 1. Boot check: the function must be installed and start cleanly. --------
// Cold starts are retried; a persistent BOOT_ERROR is a hard failure.
const sleep = ms => new Promise(r => setTimeout(r, ms));
let boot = await post({ action: 'check-name', name: 'boot probe' });
for (let attempt = 1; attempt <= 5; attempt++) {
  const broken = boot.transportError || boot.body?.code === 'BOOT_ERROR' || /BOOT_ERROR/i.test(boot.text)
    || boot.status === 546 || boot.status === 503 || boot.status === 0;
  if (!broken) break;
  if (attempt === 5) break;
  console.log(`  boot attempt ${attempt} not ready (${boot.transportError || codeOf(boot)}), retrying in 5s…`);
  await sleep(5000);
  boot = await post({ action: 'check-name', name: 'boot probe' });
}
if (boot.transportError) fail('Function reachable', `transport error ${boot.transportError}`);
if (boot.body?.code === 'BOOT_ERROR' || /BOOT_ERROR/i.test(boot.text)) {
  fail('Function boots without BOOT_ERROR', `platform returned ${sanitize(boot.text)}`);
}
if (boot.status === 546 || boot.status === 503 || boot.status === 0) {
  fail('Function boots without BOOT_ERROR', `unexpected platform status ${boot.status} ${sanitize(boot.text)}`);
}
if (boot.body === null) fail('Function returns JSON', `non-JSON response ${sanitize(boot.text)}`);
check('Function boots without BOOT_ERROR', true, `status ${boot.status}, code ${codeOf(boot)}`);

// --- 2. Signup with Name + Secret Question + Secret Answer. ------------------
const signup = await post({ action: 'signup', name: NAME, question: QUESTION, answer: ANSWER });
let loginId = signup.body?.loginId;
let reusedAccount = false;
if (signup.body?.code === 'name_taken') {
  // Stable verification account already exists: recover its Login ID instead.
  reusedAccount = true;
  const recovered = await post({ action: 'recover-id', name: NAME, question: QUESTION, answer: ANSWER });
  loginId = recovered.body?.loginId;
  if (!loginId) fail('Signup or recovery yields a Login ID', `code ${codeOf(recovered)}`);
}
if (signup.status !== 201 && !reusedAccount) fail('Signup succeeds', `status ${signup.status}, code ${codeOf(signup)}, ${sanitize(signup.text)}`);
check('Signup with Name + Secret Question + Secret Answer', true, reusedAccount ? 'existing verification account reused' : 'status 201');

// --- 3. Eight-character Login ID is returned. --------------------------------
check('Login ID is eight characters', typeof loginId === 'string' && loginId.length === 8, `length ${String(loginId ?? '').length}`);
check('Login ID uses the unambiguous server alphabet', LOGIN_ID_PATTERN.test(loginId ?? ''), 'pattern A-HJ-NP-Z2-9, length 8');

// --- 4. Login with Name + Login ID + Secret Answer. --------------------------
const login = await post({ action: 'login', name: NAME, loginId, answer: ANSWER });
if (login.status !== 200 || !login.body?.token) fail('Login succeeds', `status ${login.status}, code ${codeOf(login)}`);
guard(login.body.token);
check('Login with Name + Login ID + Secret Answer', true, 'session issued');
check('Login returns a profile without leaking stored hashes',
  !!login.body.profile?.name && !('answer_hash' in login.body.profile) && !('answer_salt' in login.body.profile) && !/token_hash|answer_hash|answer_salt/.test(login.text));
check('Session token is opaque and long enough', typeof login.body.token === 'string' && login.body.token.length >= 32, `${login.body.token.length} characters`);

// --- 5. Login ID recovery. ---------------------------------------------------
const recover = await post({ action: 'recover-id', name: NAME, question: QUESTION, answer: ANSWER });
check('Login ID recovery returns the same Login ID', recover.status === 200 && recover.body?.loginId === loginId, `status ${recover.status}, code ${codeOf(recover)}`);
const recoverWrong = await post({ action: 'recover-id', name: NAME, question: QUESTION, answer: WRONG_ANSWER });
check('Login ID recovery rejects a wrong secret answer', recoverWrong.status === 401 && recoverWrong.body?.code === 'invalid_recovery', `status ${recoverWrong.status}, code ${codeOf(recoverWrong)}`);

// --- 7. Server-validated answer rewards (before logout so the token is live). --
// Prefer Migration 009 IDs, which are confirmed present in the remote bank.
const candidates = QUESTION_BANK.filter(q => q.id >= 'bq-en-0415').slice(0, 6);
const rewardPool = candidates.length ? candidates : QUESTION_BANK.slice(0, 6);
let correctResult = null;
let correctCall = null;
let usedQuestion = null;
for (const question of rewardPool) {
  const attempt = await post({ action: 'record-answer', questionId: question.id, choice: question.correctAnswer }, { token: login.body.token });
  if (attempt.body?.ok === true || attempt.body?.code !== 'service_error') {
    correctResult = attempt.body; correctCall = attempt; usedQuestion = question; break;
  }
}
if (!correctResult) fail('Server-validated answer rewards', 'no question could be recorded');
check('Correct answer is graded server-side and rewards XP/coins',
  correctResult.correct === true && Number(correctResult.xp) > 0 && Number(correctResult.coins) > 0,
  `question ${usedQuestion.id}: correct=${correctResult.correct}, xp=${correctResult.xp}, coins=${correctResult.coins}`);
check('Server grading matches the authored correct answer', correctResult.answer === usedQuestion.correctAnswer);

const otherQuestion = rewardPool.find(q => q.id !== usedQuestion.id);
const wrongChoice = otherQuestion.answers.find(a => a !== otherQuestion.correctAnswer);
const wrongResult = await post({ action: 'record-answer', questionId: otherQuestion.id, choice: wrongChoice }, { token: login.body.token });
check('A client-chosen wrong answer cannot earn rewards',
  wrongResult.body?.ok === true && wrongResult.body.correct === false && Number(wrongResult.body.xp) === 0 && Number(wrongResult.body.coins) === 0,
  `question ${otherQuestion.id}: correct=${wrongResult.body?.correct}, xp=${wrongResult.body?.xp}`);
check('The server, not the client, reports the correct answer', wrongResult.body?.answer === otherQuestion.correctAnswer);

const replay = await post({ action: 'record-answer', questionId: usedQuestion.id, choice: usedQuestion.correctAnswer }, { token: login.body.token });
check('Replaying an answered question pays no second reward',
  replay.body?.ok === true && replay.body.alreadyAnswered === true && Number(replay.body.xp) === 0 && Number(replay.body.coins) === 0,
  `alreadyAnswered=${replay.body?.alreadyAnswered}, xp=${replay.body?.xp}`);

const profileAfter = await post({ action: 'profile' }, { token: login.body.token });
check('Profile reflects server-side progress',
  profileAfter.body?.ok === true && Number(profileAfter.body.profile.questionsAnswered) >= 2 && Number(profileAfter.body.profile.xp) > 0,
  `answered=${profileAfter.body?.profile?.questionsAnswered}, xp=${profileAfter.body?.profile?.xp}, level=${profileAfter.body?.profile?.level}`);

// --- 8. Generic client errors and rate limiting. -----------------------------
const badLogin = await post({ action: 'login', name: NAME, loginId, answer: WRONG_ANSWER });
check('Wrong secret answer is rejected with a generic error',
  badLogin.status === 401 && badLogin.body?.code === 'invalid_credentials', `status ${badLogin.status}, code ${codeOf(badLogin)}`);
const ghostLogin = await post({ action: 'login', name: `nobody-${hex(6)}`, loginId, answer: WRONG_ANSWER });
check('Unknown name returns the same generic error as a wrong answer',
  ghostLogin.status === badLogin.status && ghostLogin.body?.code === badLogin.body?.code,
  `${codeOf(ghostLogin)} vs ${codeOf(badLogin)}`);
const noSession = await post({ action: 'profile' });
check('Authenticated action without a session is rejected', noSession.status === 401 && noSession.body?.code === 'session_expired', `code ${codeOf(noSession)}`);
const noKey = await post({ action: 'check-name', name: 'x' }, { apikey: '' });
check('Request without an apikey is unauthorized', noKey.status === 401 && noKey.body?.code === 'unauthorized', `code ${codeOf(noKey)}`);
const badOrigin = await post({ action: 'check-name', name: 'x' }, { origin: 'https://not-an-allowed-origin.example' });
check('Disallowed browser origin is refused', badOrigin.status === 403 && badOrigin.body?.code === 'origin_not_allowed', `code ${codeOf(badOrigin)}`);
const unknown = await post({ action: 'not-a-real-action' }, { token: login.body.token });
check('Unknown action is rejected generically', unknown.status === 400 && unknown.body?.code === 'unknown_action', `code ${codeOf(unknown)}`);
const malformed = await post(null, { raw: '{not json' });
check('Malformed JSON body is rejected generically', malformed.status === 400 && malformed.body?.code === 'invalid_request', `code ${codeOf(malformed)}`);
const wrongMethod = await fetch(API, { method: 'GET', headers: { Origin: ORIGIN, apikey: APIKEY }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
check('Non-POST method is refused', !!wrongMethod && wrongMethod.status === 405, `status ${wrongMethod?.status}`);
const notFound = await post({ action: 'secret-question', name: NAME, loginId: 'ZZZZZZZZ' });
check('Secret question lookup for a mismatched Login ID is refused', notFound.status === 404 && notFound.body?.code === 'invalid_credentials', `code ${codeOf(notFound)}`);

// Rate limiting: recover-id allows 5 attempts per hour per identity.
let limited = null;
for (let i = 0; i < 7 && !limited; i++) {
  const attempt = await post({ action: 'recover-id', name: NAME, question: QUESTION, answer: WRONG_ANSWER });
  if (attempt.status === 429 || attempt.body?.code === 'rate_limited') limited = attempt;
}
check('Rate limiting engages after repeated attempts', !!limited && limited.body?.code === 'rate_limited', limited ? `status ${limited.status}, code ${codeOf(limited)}` : 'no 429 observed within 7 attempts');
check('Rate limit response reveals no backend detail', !!limited && !/postgres|supabase|rpc|bucket|pepper|service_role/i.test(limited?.text ?? ''), sanitize(limited?.text ?? ''));

// --- 6. Logout and session revocation. ---------------------------------------
const logout = await post({ action: 'logout' }, { token: login.body.token });
check('Logout succeeds', logout.status === 200 && logout.body?.ok === true, `code ${codeOf(logout)}`);
const revoked = await post({ action: 'profile' }, { token: login.body.token });
check('Revoked session token is refused afterwards', revoked.status === 401 && revoked.body?.code === 'session_expired', `status ${revoked.status}, code ${codeOf(revoked)}`);
const revokedReward = await post({ action: 'record-answer', questionId: usedQuestion.id, choice: usedQuestion.correctAnswer }, { token: login.body.token });
check('Revoked session cannot record answers', revokedReward.status === 401 && revokedReward.body?.code === 'session_expired', `code ${codeOf(revokedReward)}`);
const relogin = await post({ action: 'login', name: NAME, loginId, answer: ANSWER });
check('A fresh login still works after logout', relogin.status === 200 && !!relogin.body?.token, `code ${codeOf(relogin)}`);
if (relogin.body?.token) await post({ action: 'logout' }, { token: relogin.body.token });

// --- 10. Profile changes (own profile only) and Letters to Words rewards. ----
// Runs last because it renames the verification account and changes its secret answer.
const OTHER_NAME = `BQ Other ${tokenish()}`;
const OTHER_ANSWER = guard(`other-${hex(12)}`);
const other = await post({ action: 'signup', name: OTHER_NAME, question: QUESTION, answer: OTHER_ANSWER });
const session2 = await post({ action: 'login', name: NAME, loginId, answer: ANSWER });
const tok = guard(session2.body?.token || '');
const before = session2.body?.profile || {};
check('Profile returns the read-only User ID and own secret question', before.loginId === loginId && before.secretQuestion === QUESTION && before.nameChangeCount >= 0, `loginId match=${before.loginId === loginId}`);
const noAuthChange = await post({ action: 'update-profile', currentAnswer: ANSWER, name: `x${tokenish()}` });
check('Profile change without a session is refused', noAuthChange.status === 401 && noAuthChange.body?.code === 'session_expired', `code ${codeOf(noAuthChange)}`);
const wrongCurrent = await post({ action: 'update-profile', currentAnswer: WRONG_ANSWER, name: `BQ Renamed ${tokenish()}` }, { token: tok });
check('Profile change needs the current secret answer', wrongCurrent.status === 403 && wrongCurrent.body?.code === 'wrong_answer', `code ${codeOf(wrongCurrent)}`);
const takenChange = await post({ action: 'update-profile', currentAnswer: ANSWER, name: OTHER_NAME.toUpperCase() }, { token: tok });
check('Username already used by another account is rejected (case-insensitive)', other.status === 201 && takenChange.status === 409 && takenChange.body?.code === 'name_taken', `code ${codeOf(takenChange)}`);
const NEW_NAME = `BQ Renamed ${tokenish()}`;
const renamed = await post({ action: 'update-profile', currentAnswer: ANSWER, name: NEW_NAME }, { token: tok });
const rp = renamed.body?.profile || {};
const days = rp.nextNameChangeAt ? (Date.parse(rp.nextNameChangeAt) - Date.now()) / 86400000 : 0;
check('Username change keeps the same User ID and progress', renamed.status === 200 && rp.name === NEW_NAME && rp.loginId === loginId && rp.xp === before.xp && rp.coins === before.coins && rp.questionsAnswered === before.questionsAnswered, `status ${renamed.status}, code ${codeOf(renamed)}`);
check('First username change starts a 7-day cooldown stored on the server', rp.nameChangeCount === 1 && days > 6.9 && days <= 7.01, `count=${rp.nameChangeCount}, days=${days.toFixed(2)}`);
const tooSoon = await post({ action: 'update-profile', currentAnswer: ANSWER, name: `BQ Again ${tokenish()}` }, { token: tok });
check('A second username change inside the cooldown is refused with the date', tooSoon.status === 409 && tooSoon.body?.code === 'name_cooldown' && Date.parse(tooSoon.body?.nextChangeAt) > Date.now(), `code ${codeOf(tooSoon)}`);
const NEW_ANSWER = guard(`changed-${hex(12)}`), NEW_QUESTION = 'Who was your first teacher?';
const secretChange = await post({ action: 'update-profile', currentAnswer: ANSWER, question: NEW_QUESTION, answer: NEW_ANSWER }, { token: tok });
check('Secret question and answer can be changed', secretChange.status === 200 && secretChange.body?.profile?.secretQuestion === NEW_QUESTION && !secretChange.text.includes(NEW_ANSWER), `code ${codeOf(secretChange)}`);
const loginNew = await post({ action: 'login', name: NEW_NAME.toLowerCase(), loginId, answer: NEW_ANSWER });
const loginOldAnswer = await post({ action: 'login', name: NEW_NAME, loginId, answer: ANSWER });
const loginOldName = await post({ action: 'login', name: NAME, loginId, answer: NEW_ANSWER });
check('Login works with the new username and new answer; old ones are refused', loginNew.status === 200 && loginNew.body?.profile?.loginId === loginId && loginOldAnswer.status === 401 && loginOldName.status === 401, `${loginNew.status}/${loginOldAnswer.status}/${loginOldName.status}`);
const wtok = guard(loginNew.body?.token || '');
const word1 = await post({ action: 'record-word', letters: 'DROF', word: 'FOR' }, { token: wtok });
const word2 = await post({ action: 'record-word', letters: 'DROF', word: 'FOR' }, { token: wtok });
const wordBad = await post({ action: 'record-word', letters: 'DROF', word: 'ROD' }, { token: wtok });
const wordFake = await post({ action: 'record-word', letters: 'DROF', word: 'DRO' }, { token: wtok });
const wordLetters = await post({ action: 'record-word', letters: 'DROF', word: 'FOX' }, { token: wtok });
const wordTwo = await post({ action: 'record-word', letters: 'DROF', word: 'OF' }, { token: wtok });
check('Letters to Words: a real word earns 5 XP and 1 coin the first time (Migration 016)', word1.body?.valid === true && word1.body.xp === 5 && word1.body.coins === 1 && word1.body.profile?.xp === loginNew.body.profile.xp + word1.body.xp, `xp=${word1.body?.xp}, coins=${word1.body?.coins}`);
check('Letters to Words: finding the same word again pays nothing', word2.body?.valid === true && word2.body.alreadyFound === true && word2.body.xp === 0, `alreadyFound=${word2.body?.alreadyFound}`);
check('Letters to Words: non-words and letters not in the puzzle are rejected', wordFake.body?.valid === false && wordFake.body.xp === 0 && wordLetters.status === 400 && wordLetters.body?.code === 'invalid_word' && wordBad.body?.valid === true, `${codeOf(wordFake)} valid=${wordFake.body?.valid}, ${codeOf(wordLetters)}`);
check('Letters to Words: a two-letter word also earns 5 XP and 1 coin', wordTwo.body?.valid === true && wordTwo.body.xp === 5 && wordTwo.body.coins === 1, `code ${codeOf(wordTwo)}, xp=${wordTwo.body?.xp}`);
// Feedback (Migration 017): only refusal paths are exercised, so live checks never put test messages in the owner's inbox.
const fbWrongName = await post({ action: 'submit-feedback', name: 'Somebody Else', kind: 'feedback', message: 'Live check message' }, { token: wtok });
const fbBadShot = await post({ action: 'submit-feedback', name: NEW_NAME, kind: 'problem', message: 'Live check message', screenshot: 'data:text/html;base64,PHNjcmlwdD4=' }, { token: wtok });
const fbNoAuth = await post({ action: 'submit-feedback', name: NEW_NAME, kind: 'feedback', message: 'Live check message' });
const fbInbox = await post({ action: 'feedback-inbox' }, { token: wtok });
const fbItem = await post({ action: 'feedback-item', id: 1 }, { token: wtok });
check('Feedback: a name that is not the signed-in account is refused', fbWrongName.status === 403 && fbWrongName.body?.code === 'name_mismatch', `code ${codeOf(fbWrongName)}`);
check('Feedback: only image screenshots are accepted, and a session is required', fbBadShot.status === 400 && fbBadShot.body?.code === 'invalid_request' && fbNoAuth.status === 401, `${codeOf(fbBadShot)}/${codeOf(fbNoAuth)}`);
check('Feedback inbox: players who are not the admin are refused', fbInbox.status === 403 && fbInbox.body?.code === 'forbidden' && fbItem.status === 403 && loginNew.body?.profile?.isAdmin === false, `${codeOf(fbInbox)}/${codeOf(fbItem)}, isAdmin=${loginNew.body?.profile?.isAdmin}`);
// Sound Match rewards (Migration 018): the server pays once, only for a believable finish.
const smStart = await post({ action: 'soundmatch-start', level: 'easy' }, { token: wtok });
const smGame = smStart.body?.gameId;
const smFast = await post({ action: 'soundmatch-finish', gameId: smGame, tries: 5 }, { token: wtok });
const smBadTries = await post({ action: 'soundmatch-finish', gameId: smGame, tries: 3 }, { token: wtok });
await new Promise(r => setTimeout(r, 8500)); // Easy needs at least 7.5 seconds (5 pairs x 1.5 s)
const smDone = await post({ action: 'soundmatch-finish', gameId: smGame, tries: 5 }, { token: wtok });
const smAgain = await post({ action: 'soundmatch-finish', gameId: smGame, tries: 5 }, { token: wtok });
const smBadLevel = await post({ action: 'soundmatch-start', level: 'impossible' }, { token: wtok });
check('Sound Match: a game is registered; impossible finishes are refused (too fast, too few tries, bad level)', smStart.status === 200 && /^[0-9a-f-]{36}$/.test(smGame || '') && smFast.body?.code === 'too_fast' && smBadTries.body?.code === 'invalid_tries' && smBadLevel.status === 400, `${codeOf(smStart)}/${codeOf(smFast)}/${codeOf(smBadTries)}/${codeOf(smBadLevel)}`);
check('Sound Match: a perfect Easy board pays 10 XP and 1 coin, exactly once', smDone.body?.ok === true && smDone.body.stars === 3 && smDone.body.xp === 10 && smDone.body.coins === 1 && smDone.body.profile?.xp === (wordTwo.body?.profile?.xp ?? -99) + 10 && smAgain.body?.code === 'already_finished', `stars=${smDone.body?.stars}, xp=${smDone.body?.xp}, coins=${smDone.body?.coins}, again=${codeOf(smAgain)}`);
// Social (Migration 019): presence, private player cards, friend request -> notification -> accept, admin-only actions.
const otherLogin = await post({ action: 'login', name: OTHER_NAME, loginId: other.body?.loginId, answer: OTHER_ANSWER });
const otok = guard(otherLogin.body?.token || '');
const beatA = await post({ action: 'touch' }, { token: wtok }), beatB = await post({ action: 'touch' }, { token: otok });
const online = await post({ action: 'online-players' }, { token: wtok });
check('Presence: signed-in players appear online', beatA.status === 200 && typeof beatA.body?.unread === 'number' && beatB.status === 200 && (online.body?.items || []).some(p => p.name === OTHER_NAME), `${codeOf(beatA)}/${codeOf(online)}, ${(online.body?.items || []).length} online`);
const card = await post({ action: 'player-card', name: OTHER_NAME.toLowerCase() }, { token: wtok });
const ghostCard = await post({ action: 'player-card', name: `nobody ${tokenish()}` }, { token: wtok });
check('Player card shows activity only, never the Login ID or secret question', card.status === 200 && card.body?.player?.name === OTHER_NAME && typeof card.body.player.questionsAnswered === 'number' && !card.text.includes(other.body?.loginId || '\u0000') && !/loginId|login_id|secret|question\b/i.test(JSON.stringify(Object.keys(card.body.player))) && ghostCard.status === 409 && ghostCard.body?.code === 'player_unavailable', `${codeOf(card)}/${codeOf(ghostCard)}`);
const fReq = await post({ action: 'friend-request', name: OTHER_NAME }, { token: wtok });
const oNotes = await post({ action: 'notifications' }, { token: otok });
const reqNote = (oNotes.body?.items || []).find(n => n.kind === 'friend_request' && n.actor === NEW_NAME);
check('Friend request: the other player gets an "X sent a friend request" notification', fReq.body?.relation === 'outgoing' && !!reqNote && reqNote.relation === 'incoming' && reqNote.read === false, `${codeOf(fReq)}, note=${!!reqNote}`);
const fAccept = await post({ action: 'friend-respond', name: NEW_NAME, accept: true }, { token: otok });
const fList = await post({ action: 'friends' }, { token: wtok });
const aNotes = await post({ action: 'notifications' }, { token: wtok });
check('Friend request accepted: both are friends and the sender is notified', fAccept.body?.relation === 'friends' && (fList.body?.friends || []).some(f => f.name === OTHER_NAME) && (aNotes.body?.items || []).some(n => n.kind === 'friend_accepted' && n.actor === OTHER_NAME), `${codeOf(fAccept)}/${codeOf(fList)}`);
// End-to-end encrypted messages (Migration 020): real WebCrypto keys; the server only relays sealed boxes.
const E2 = await import('../src/e2ee.js');
const devA = await E2.deviceKey(E2.memoryStore(), 'live-a'), devB = await E2.deviceKey(E2.memoryStore(), 'live-b');
const regA = await post({ action: 'register-device', deviceId: devA.deviceId, publicKey: devA.publicKey }, { token: wtok });
const regB = await post({ action: 'register-device', deviceId: devB.deviceId, publicKey: devB.publicKey }, { token: otok });
const regSteal = await post({ action: 'register-device', deviceId: devA.deviceId, publicKey: devB.publicKey }, { token: otok });
const mKeys = await post({ action: 'message-keys', name: OTHER_NAME }, { token: wtok });
const SECRET_TEXT = `Live encrypted hello ${tokenish()}`;
const sealed = await E2.seal(SECRET_TEXT, devA, [...(mKeys.body?.theirs || []), devA]);
const mSend = await post({ action: 'send-message', name: OTHER_NAME, deviceId: devA.deviceId, boxes: sealed }, { token: wtok });
const mForged = await post({ action: 'send-message', name: OTHER_NAME, deviceId: devB.deviceId, boxes: sealed }, { token: wtok });
const mPlain = await post({ action: 'send-message', name: OTHER_NAME, deviceId: devA.deviceId, text: 'plain text' }, { token: wtok });
const mInbox = await post({ action: 'messages', name: NEW_NAME, deviceId: devB.deviceId, afterId: null }, { token: otok });
const got = (mInbox.body?.messages || []).at(-1);
let opened = '';
try { opened = (await E2.open(got.box, devB, got.senderDevice, got.senderKey)).t; } catch {}
check('Encrypted messages: device keys register; a device id cannot be taken over', regA.body?.ok === true && regB.body?.ok === true && regSteal.status === 409 && (mKeys.body?.theirs || []).some(k => k.deviceId === devB.deviceId), `${codeOf(regA)}/${codeOf(regB)}/${codeOf(regSteal)}/${codeOf(mKeys)}`);
check('Encrypted messages: the friend opens the sealed message; the server never received the text', mSend.body?.ok === true && opened === SECRET_TEXT && !mSend.text.includes(SECRET_TEXT) && !mInbox.text.includes(SECRET_TEXT) && got?.fromMe === false, `${codeOf(mSend)}/${codeOf(mInbox)}, opened=${opened === SECRET_TEXT}`);
check('Encrypted messages: another person\'s device id and plain-text bodies are refused', mForged.status === 409 && mForged.body?.code === 'device_unknown' && mPlain.status === 400, `${codeOf(mForged)}/${codeOf(mPlain)}`);
// Rooms (Migration 021): default public rooms, private rooms for friends only, live game events for spectators, comments, match invites.
const rList = await post({ action: 'rooms' }, { token: wtok });
const pubRoom = (rList.body?.items || []).find(r => r.name === 'Blind Quiz' && r.isDefault);
check('Rooms: three default public rooms with game and user counts', (rList.body?.items || []).filter(r => r.isDefault).length === 3 && !!pubRoom && typeof pubRoom.games === 'number' && typeof pubRoom.users === 'number', `${codeOf(rList)}, ${(rList.body?.items || []).length} rooms`);
const rState = await post({ action: 'room-state', roomId: pubRoom?.id, afterId: null }, { token: wtok });
const rSay = await post({ action: 'room-say', roomId: pubRoom?.id, text: `Live room hello ${tokenish()}` }, { token: wtok });
const rSeen = await post({ action: 'room-state', roomId: pubRoom?.id, afterId: null }, { token: otok });
check('Rooms: entering shows the people there and room chat reaches others', rState.body?.ok === true && (rState.body.people || []).some(p => p.name === NEW_NAME) && rSay.body?.ok === true && (rSeen.body?.chat || []).some(c => c.name === NEW_NAME) && !/loginId|login_id/.test(rSeen.text), `${codeOf(rState)}/${codeOf(rSay)}/${codeOf(rSeen)}`);
const rPriv = await post({ action: 'room-create', name: `Live ${tokenish()}`, isPublic: false }, { token: wtok });
const rClosed = await post({ action: 'room-state', roomId: rPriv.body?.id, afterId: null }, { token: otok });
const rInvite = await post({ action: 'room-invite', roomId: rPriv.body?.id, name: OTHER_NAME }, { token: wtok });
const rOpen = await post({ action: 'room-state', roomId: rPriv.body?.id, afterId: null }, { token: otok });
check('Rooms: a private room opens only for invited friends', rPriv.body?.ok === true && rClosed.body?.code === 'room_unavailable' && rInvite.body?.ok === true && rOpen.body?.ok === true, `${codeOf(rPriv)}/${codeOf(rClosed)}/${codeOf(rInvite)}/${codeOf(rOpen)}`);
const gNew = await post({ action: 'game-create', roomId: pubRoom?.id, kind: 'quiz', title: 'Live check quiz', config: { category: 'history', mode: 'classic' } }, { token: wtok });
const gPost = await post({ action: 'game-post', gameId: gNew.body?.id, events: [{ k: 'sfx', b: 'correct' }, { k: 'say', b: 'Correct!' }, { k: 'score', b: '1' }, { k: 'sfx', b: '../../bad' }] }, { token: wtok });
const gSpy = await post({ action: 'game-post', gameId: gNew.body?.id, events: [{ k: 'say', b: 'not my game' }] }, { token: otok });
const gWatch = await post({ action: 'game-watch', gameId: gNew.body?.id, afterId: null }, { token: otok });
const gComment = await post({ action: 'room-say', roomId: pubRoom?.id, gameId: gNew.body?.id, text: 'Nice!' }, { token: otok });
const gEnd = await post({ action: 'game-post', gameId: gNew.body?.id, events: [{ k: 'end', b: '' }] }, { token: wtok });
const gAfter = await post({ action: 'game-watch', gameId: gNew.body?.id, afterId: null }, { token: otok });
check('Room games: spectators get the player\'s sounds, announcements and score; only players post; comments work', gNew.body?.ok === true && gPost.body?.stored === 3 && gSpy.body?.code === 'game_unavailable' && (gWatch.body?.events || []).map(e => e.kind).join() === 'sfx,say,score' && gComment.body?.ok === true && gAfter.body?.status === 'finished' && (gAfter.body.events || []).some(e => e.kind === 'comment'), `${codeOf(gNew)}/${gPost.body?.stored}/${codeOf(gSpy)}/${codeOf(gWatch)}/${gAfter.body?.status}`);
const mInv = await post({ action: 'match-invite', name: OTHER_NAME }, { token: wtok });
const mNotes = await post({ action: 'notifications' }, { token: otok });
check('Send a match: friends get a game invite that opens a private room', mInv.body?.ok === true && (mNotes.body?.items || []).some(n => n.kind === 'game_invite' && n.ref === mInv.body.roomId), `${codeOf(mInv)}`);
const rRemove = await post({ action: 'room-remove', roomId: rPriv.body?.id }, { token: wtok });
const rBad = await post({ action: 'game-create', roomId: pubRoom?.id, kind: 'chess', title: 'Nope', config: {} }, { token: wtok });
check('Rooms: owners remove their rooms; unknown game kinds are rejected', rRemove.body?.ok === true && rBad.status === 400, `${codeOf(rRemove)}/${codeOf(rBad)}`);
// Migration 023: room voice messages (24 hours) and sealed signals for direct file transfer and calls.
const VOICE = 'data:audio/webm;codecs=opus;base64,' + Buffer.from(randomBytes(300)).toString('base64');
const vSend = await post({ action: 'room-voice-send', roomId: mInv.body?.roomId, audio: VOICE, durationMs: 2500 }, { token: wtok });
const vState = await post({ action: 'room-state', roomId: mInv.body?.roomId, afterId: null }, { token: otok });
const vGet = await post({ action: 'room-voice', id: vSend.body?.id }, { token: otok });
const vBad = await post({ action: 'room-voice-send', roomId: mInv.body?.roomId, audio: 'data:text/html;base64,PHNjcmlwdD4=', durationMs: 2500 }, { token: wtok });
check('Room voice messages: others in the room can play them; only audio is accepted', vSend.body?.ok === true && (vState.body?.voices || []).some(v => v.id === vSend.body.id && v.name === NEW_NAME) && !vState.text.includes('base64') && vGet.body?.audio === VOICE && vBad.status === 400, `${codeOf(vSend)}/${codeOf(vState)}/${codeOf(vGet)}/${codeOf(vBad)}`);
const SESSION = randomUUID();
const ringText = JSON.stringify({ t: 'file-offer', name: 'notes.pdf', size: 7000000 });
const ringBoxes = await E2.seal(ringText, devA, mKeys.body?.theirs || []);
const sRing = await post({ action: 'signal-send', name: OTHER_NAME, deviceId: devA.deviceId, session: SESSION, kind: 'ring', boxes: ringBoxes }, { token: wtok });
const sBeat = await post({ action: 'touch' }, { token: otok });
const sPoll = await post({ action: 'signals', deviceId: devB.deviceId, afterId: null }, { token: otok });
const sig = (sPoll.body?.signals || []).find(x => x.session === SESSION);
let sOpened = null; try { sOpened = sig ? (await E2.open(sig.box, devB, sig.senderDevice, sig.senderKey)).t : null; } catch { sOpened = null; }
const sSpy = await post({ action: 'signals', deviceId: devB.deviceId, afterId: null }, { token: wtok });
check('Direct transfer and call setup: sealed ring reaches the online friend, opens only on their device', sRing.body?.ok === true && sBeat.body?.ring >= 1 && sOpened === ringText && !sPoll.text.includes('notes.pdf') && sSpy.body?.code === 'device_unknown', `${codeOf(sRing)}/ring=${sBeat.body?.ring}/${codeOf(sPoll)}/${codeOf(sSpy)}`);
const fRemove = await post({ action: 'friend-remove', name: OTHER_NAME }, { token: wtok });
const mAfter = await post({ action: 'send-message', name: OTHER_NAME, deviceId: devA.deviceId, boxes: sealed }, { token: wtok });
check('Encrypted messages: only friends can message each other', mAfter.status === 409 && mAfter.body?.code === 'not_friends', `${codeOf(mAfter)}`);
const cardAfter = await post({ action: 'player-card', name: OTHER_NAME }, { token: wtok });
const readAll = await post({ action: 'notifications-read', ids: null }, { token: otok });
check('Friends can be removed; notifications can be marked read', fRemove.body?.relation === 'none' && cardAfter.body?.player?.relation === 'none' && readAll.body?.unread === 0, `${codeOf(fRemove)}/${codeOf(readAll)}`);
const notifOff = await post({ action: 'set-notifications', enabled: false }, { token: otok });
const notifBad = await post({ action: 'set-notifications', enabled: 'yes' }, { token: otok });
const myFb = await post({ action: 'my-feedback' }, { token: wtok });
check('Notification switch and My feedback work; bad input is refused', notifOff.body?.notificationsEnabled === false && notifBad.status === 400 && Array.isArray(myFb.body?.items), `${codeOf(notifOff)}/${codeOf(notifBad)}/${codeOf(myFb)}`);
const annNo = await post({ action: 'admin-announce', text: 'Live check announcement' }, { token: wtok });
const replyNo = await post({ action: 'admin-feedback-reply', id: 1, reply: 'Live check reply' }, { token: wtok });
const socialNoAuth = await post({ action: 'friends' });
check('Announcements and feedback replies are admin only; social actions need a session', annNo.status === 403 && annNo.body?.code === 'forbidden' && replyNo.status === 403 && socialNoAuth.status === 401, `${codeOf(annNo)}/${codeOf(replyNo)}/${codeOf(socialNoAuth)}`);
const socialResponses = [vSend, vState, vGet, vBad, sRing, sBeat, sPoll, sSpy, rList, rState, rSay, rSeen, rPriv, rClosed, rInvite, rOpen, gNew, gPost, gSpy, gWatch, gComment, gEnd, gAfter, mInv, mNotes, rRemove, otherLogin, beatA, beatB, online, card, ghostCard, fReq, oNotes, fAccept, fList, aNotes, regA, regB, regSteal, mKeys, mSend, mForged, mPlain, mInbox, fRemove, mAfter, cardAfter, readAll, notifOff, myFb, annNo, replyNo];
for (const t of [tok, wtok, otok]) if (t) await post({ action: 'logout' }, { token: t });
const profileResponses = [session2, noAuthChange, wrongCurrent, takenChange, renamed, tooSoon, secretChange, loginNew, word1, word2, wordFake, wordLetters, wordTwo, fbWrongName, fbBadShot, fbInbox, fbItem, smStart, smFast, smDone, smAgain, ...socialResponses.filter(r => r !== otherLogin)];
check('Profile and word responses never contain hashes, salts, or the secret answers',
  !/answer_hash|answer_salt|token_hash|name_normalized/.test(profileResponses.map(r => r.text).join('\n')) && !profileResponses.some(r => r.text.includes(ANSWER) || r.text.includes(NEW_ANSWER)));

// --- 9. Response hygiene across every body received. --------------------------
// Login responses legitimately carry the new session token, so they are the
// only ones allowed to contain it; everything else must be free of secret
// material and of backend implementation detail.
const everyResponse = [boot, signup, login, recover, recoverWrong, correctCall, wrongResult, replay,
  profileAfter, badLogin, ghostLogin, noSession, noKey, badOrigin, unknown, malformed, notFound,
  limited, logout, revoked, revokedReward, relogin].filter(r => r && typeof r.text === 'string');
const nonLoginText = everyResponse.filter(r => r !== login && r !== relogin).map(r => r.text).join('\n');

check('No response leaks keys, hashes, salts, or stack traces',
  !/service_role|sb_secret|SUPABASE_SERVICE_ROLE_KEY|PEPPER|token_hash|answer_hash|answer_salt|at index\.ts|SyntaxError|BOOT_ERROR|Traceback|postgres/i.test(everyResponse.map(r => r.text).join('\n')),
  `scanned ${everyResponse.length} response bodies`);
check('Secret answer is never echoed back to the client',
  !nonLoginText.includes(ANSWER) && !nonLoginText.includes(WRONG_ANSWER) && !login.text.includes(ANSWER) && !relogin.text.includes(ANSWER));
check('Session token appears only in the login response that issued it',
  login.text.includes(login.body.token) && !nonLoginText.includes(login.body.token)
  && (!relogin.body?.token || (relogin.text.includes(relogin.body.token) && relogin.body.token !== login.body.token)));
check('Recovery response carries the Login ID and nothing else sensitive',
  recover.body?.loginId === loginId && Object.keys(recover.body).sort().join(',') === 'loginId,ok');

summarize();
process.exit(failures === 0 ? 0 : 1);
