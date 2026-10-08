import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  QUESTION_BANK,
  CATEGORY_LIST,
  STARTER_QUESTION_COUNT,
  MIGRATION_009_QUESTION_COUNT,
  MIGRATION_010_QUESTION_COUNT,
  validateQuestionBank,
} from '../src/content.js';
import { shuffled } from '../src/random.js';
import {
  GAME_MODES,
  poolFor,
  selectRoundQuestions,
  timeLimitFor,
  endsAfterMiss,
} from '../src/game-logic.js';

assert.deepEqual(validateQuestionBank(), [], 'question pack validation');
assert.equal(STARTER_QUESTION_COUNT, 73, 'historical starter IDs stay stable');
assert.equal(MIGRATION_009_QUESTION_COUNT, 252, 'applied Migration 009 content remains stable');
assert.equal(MIGRATION_010_QUESTION_COUNT, 500, 'Migration 010 adds exactly 500 questions');
assert.equal(QUESTION_BANK.length, 825, '73 historical plus 252 prior and 500 new questions');
assert.equal(CATEGORY_LIST.length, 25, 'all 25 categories are available');
assert.equal(new Set(CATEGORY_LIST.map(category => category.id)).size, 25, 'category IDs are unique');

const migration010Start = STARTER_QUESTION_COUNT + MIGRATION_009_QUESTION_COUNT;
const migration010Questions = QUESTION_BANK.slice(migration010Start);
for (const category of CATEGORY_LIST) {
  const added = migration010Questions.filter(question => question.category === category.id);
  assert.equal(added.length, 20, `${category.id} has 20 Migration 010 questions`);
}
assert.deepEqual(
  CATEGORY_LIST.slice(-5).map(category => category.id),
  ['mathematics', 'health', 'literature', 'food', 'arts'],
  'five new categories complete the 25-category pack',
);
assert.equal(QUESTION_BANK[73].id, 'bq-en-0415', 'Migration 009 starts at its historical ID');
assert.equal(QUESTION_BANK[migration010Start].id, 'bq-en-0667', 'Migration 010 starts after applied IDs');
assert.equal(QUESTION_BANK.at(-1).id, 'bq-en-1166', 'Migration 010 ends at its reserved final ID');
assert.equal(new Set(QUESTION_BANK.map(question => question.id)).size, QUESTION_BANK.length, 'question IDs are unique');
for (const question of migration010Questions) {
  assert.match(question.sourceNote, /https:\/\//, `${question.id} has a source note`);
  assert.equal(new Set(question.answers).size, 4, `${question.id} has four distinct choices`);
  assert.ok(question.answers.includes(question.correctAnswer), `${question.id} has a listed correct answer`);
}

const source = ['A', 'B', 'C', 'D'];
const deterministic = shuffled(source, maximum => maximum - 1);
assert.deepEqual(deterministic, source, 'shuffle supports the final index');
assert.notEqual(shuffled(source, () => 0), source, 'shuffle can move the authored correct-first choice');
assert.deepEqual([...shuffled(source, () => 0)].sort(), source, 'shuffle preserves every answer');

const identity = values => [...values];
const balancedClassic = selectRoundQuestions(QUESTION_BANK, 'general', 'classic', identity);
assert.equal(balancedClassic.length, 10, 'classic mixed round has ten questions');
assert.equal(new Set(balancedClassic.map(question => question.category)).size, 10, 'classic mixed round balances categories');
const randomMix = selectRoundQuestions(QUESTION_BANK, 'general', 'random', identity);
assert.equal(randomMix.length, 10, 'random mix has ten questions');
assert.equal(new Set(randomMix.map(question => question.category)).size, 1, 'random mix samples the full bank without classic balancing');
assert.equal(selectRoundQuestions(QUESTION_BANK, 'science', 'classic', identity).every(question => question.category === 'science'), true, 'category round stays in its category');
assert.equal(poolFor(QUESTION_BANK, 'general', 'vocabulary').every(question => question.category === 'vocabulary'), true, 'vocabulary mode filters to vocabulary');
assert.equal(selectRoundQuestions(QUESTION_BANK, 'general', 'rapid', identity).length, 8, 'Rapid Fire has eight questions');
assert.equal(timeLimitFor('rapid', 30), 15, 'Rapid Fire always uses its stated 15-second clock');
assert.equal(selectRoundQuestions(QUESTION_BANK, 'general', 'timeattack', identity).length, 10, 'Time Attack has ten questions');
assert.equal(timeLimitFor('timeattack', 30), 10, 'Time Attack always uses its stated 10-second clock');
assert.equal(timeLimitFor('classic', 30), 30, 'other modes respect the configured timer');
assert.equal(timeLimitFor('classic', Number.NaN), 0, 'invalid timers safely fall back to off');
assert.equal(selectRoundQuestions(QUESTION_BANK, 'general', 'survival', identity).length, 20, 'Survival has a longer 20-question run');
assert.equal(endsAfterMiss('survival', false), true, 'a miss ends Survival');
assert.equal(endsAfterMiss('survival', true), false, 'a correct answer continues Survival');
assert.equal(endsAfterMiss('classic', false), false, 'a miss does not end Classic');
assert.deepEqual(
  GAME_MODES.map(mode => mode[0]),
  ['classic', 'rapid', 'timeattack', 'survival', 'random', 'vocabulary', 'abbreviations', 'braille'],
  'all supported modes have UI labels and selection behavior',
);

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
for (const id of ['home', 'auth', 'game', 'settings', 'results', 'announcer', 'assertive-announcer']) {
  assert(html.includes(`id="${id.startsWith('announcer') ? id : `view-${id}`}"`) || html.includes(`id="${id}"`), `required UI landmark ${id}`);
}
assert(html.includes('aria-live="polite"') && html.includes('aria-live="assertive"'), 'live regions');
assert(html.includes('id="recovery-form"') && html.includes('Forgot Login ID?'), 'login ID recovery UI');
assert(html.includes('Eight-character Login ID'), 'Login ID field');
assert(!/<input[^>]*type="(?:email|password)"/i.test(html), 'no email/password input fields');
assert(!html.includes('sfx-on'), 'no unavailable sound-effect control');
assert(html.includes('id="mode-list"'), 'game modes are available in the home view');

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
assert(css.includes(':focus-visible'), 'visible focus indicator');
assert(css.includes('.high-contrast') && css.includes('.large-text') && css.includes('.reduce-motion'), 'accessibility settings styles');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
for (const match of main.matchAll(/\$\(['\"]#([a-zA-Z0-9_-]+)['\"]/g)) {
  assert(new RegExp(`\\bid=[\"']${match[1]}[\"']`).test(html), `main.js selector #${match[1]} exists in the document`);
}
assert(html.includes('<b>25</b> categories'), 'home status reports the actual number of categories');
assert(!/(AudioContext|createOscillator|\btone\s*\()/.test(main), 'no broken or synthetic audio effects');
assert(/displayAnswers:\s*shuffled\(question\.answers\)/.test(main), 'answer choices are shuffled independently');
assert(main.includes('state.roundToken += 1') && main.includes('state.view !== \'game\''), 'leaving a round cancels stale countdowns and callbacks');
assert(main.includes('announcementTokens[channel] === token'), 'stale screen-reader announcements are discarded');
assert(main.includes('if (state.timer !== null) clearInterval(state.timer)'), 'timer cleanup handles every valid timer handle');
assert(main.includes("$('#game-copy').hidden = true") && !main.includes("stage.querySelector('.game-copy')?.remove()"), 'round restart keeps the countdown copy element in the DOM');
assert(main.includes('endsAfterMiss(state.mode, state.lastAnswerCorrect)'), 'Survival ends only after a miss');
assert(main.includes("$('.callout [data-category=\"braille\"]')") && !main.includes("$$('[data-category=\"braille\"]')"), 'Braille shortcut does not double-bind category buttons');
const answerHandler = main.slice(main.indexOf('function chooseAnswer'), main.indexOf('function timeExpired'));
assert(answerHandler.indexOf('offerNextQuestion();') < answerHandler.indexOf('void saveAnswerToProfile('), 'profile network latency never blocks quiz progression');
assert(!/state\.score\s*=\s*saved\.correct/.test(main), 'historical server answer records cannot overwrite the current round score');
assert(main.includes('no additional profile reward was issued'), 'replayed profile answers do not corrupt round score feedback');
assert(html.includes('id="game-start"') && main.includes('Get ready!') && main.includes("['3', '2', '1']") && main.includes("'GO!'"), 'ready screen and visible countdown remain available');
assert(main.includes('Something went wrong. Please try again.') && main.includes('Too many attempts. Please wait and try again.'), 'client errors remain generic and rate limits are explained');
const categoryRender = main.slice(main.indexOf('function renderCategories'), main.indexOf('function renderModes'));
assert(categoryRender.includes('<strong>${esc(category.name)}</strong>'), 'category buttons contain the category name');
assert(!/category-mark|category-count|category\.description/.test(categoryRender), 'category buttons stay uncluttered');
const backend = await readFile(new URL('../src/backend.js', import.meta.url), 'utf8');
assert(backend.includes('REQUEST_TIMEOUT_MS') && backend.includes('controller.abort()'), 'API requests time out instead of hanging indefinitely');
assert(backend.includes('memorySession') && backend.includes('sessionStorage'), 'session storage failures have an in-memory fallback');
assert(backend.includes('JSON.stringify({ ...payload, action })'), 'callers cannot override the API action');
const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
assert(worker.includes('blind-quiz-shell-v4'), 'service worker cache version changes with the app shell');
for (const asset of ['expansion-questions-010-a.js', 'expansion-questions-010-b.js', 'expansion-questions-010-c.js', 'expansion-questions-010-d.js', 'expansion-questions-010-e.js', 'game-logic.js']) {
  assert(worker.includes(asset), `${asset} is available to offline rounds`);
}

const migration = await readFile(new URL('../supabase/migrations/202609260001_core.sql', import.meta.url), 'utf8');
for (const term of ['name_normalized text not null unique', 'login_id text not null unique', 'answer_hash text not null', 'enable row level security', 'bq_record_answer', 'unique(profile_id,question_id)']) {
  assert(migration.includes(term), `schema requirement ${term}`);
}
const migration010 = await readFile(new URL('../supabase/migrations/202610070010_expand_question_bank.sql', import.meta.url), 'utf8');
assert.equal((migration010.match(/insert into public\.bq_questions/g) || []).length, 500, 'Migration 010 inserts exactly 500 questions');
assert(migration010.includes("'bq-en-0667'") && migration010.includes("'bq-en-1166'"), 'Migration 010 uses its reserved ID range');
const exportScript = await readFile(new URL('../scripts/export-seed.mjs', import.meta.url), 'utf8');
assert(exportScript.includes('Migration 009 is applied remotely. Never regenerate or modify it here.'), 'content validation never rewrites applied Migration 009');

const fn = await readFile(new URL('../supabase/functions/blind-quiz-api/index.ts', import.meta.url), 'utf8');
for (const term of ['PBKDF2', '310000', 'name_taken', 'loginId', 'bq_consume_attempt', 'token_hash', 'record-answer']) {
  assert(fn.includes(term), `server feature ${term}`);
}
assert.equal((fn.match(/^import \{ createClient \}/gm) || []).length, 1, 'one Supabase client import');
assert.equal((fn.match(/\bcreateClient\s*\(/g) || []).length, 1, 'one admin client initialization');
assert.equal((fn.match(/Deno\.serve\(handler\)/g) || []).length, 1, 'one Edge Function entrypoint');
for (const term of ["action==='signup'", "action==='login'", "action==='recover-id'", "action==='logout'", "action==='record-answer'", "action==='profile'"]) {
  assert(fn.includes(term), `server action ${term}`);
}
assert(fn.includes("return json({ok:false,code:'rate_limited'},429,origin)"), 'server enforces rate limits');
assert(fn.includes('p_choice:choice'), 'answer rewards use the server-side answer RPC');
const logArguments = [...fn.matchAll(/console\.(?:log|error)\(([^;]*?)\);/g)].map(match => match[1].replace(/(['"])[^'"]*\1/g, ''));
assert(logArguments.every(args => !/(?:\bSECRET\b|\bPEPPER\b|\bAuthorization\b|\btoken\b|\banswer\b|\braw\b)/i.test(args)), 'never log secrets, sessions, auth headers, or secret answers');
assert(!/secret answer.{0,50}console\.log/i.test(fn), 'do not log secret answers');
const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
assert.equal(manifest.name.startsWith('Blind Quiz'), true);
console.log(`PASS: ${QUESTION_BANK.length} questions in ${CATEGORY_LIST.length} categories; 500 additions, gameplay, content, schema, security, and accessibility checks.`);
