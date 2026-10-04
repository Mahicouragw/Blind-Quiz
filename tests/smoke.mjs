import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUESTION_BANK, CATEGORY_LIST, STARTER_QUESTION_COUNT, validateQuestionBank } from '../src/content.js';
import { shuffled } from '../src/random.js';

assert.deepEqual(validateQuestionBank(),[],'question pack validation');
assert.equal(STARTER_QUESTION_COUNT,73,'historical starter IDs stay stable');
assert.equal(QUESTION_BANK.length,325,'73 existing plus 252 new questions');
assert.equal(CATEGORY_LIST.length,20,'all established categories');
for(const category of CATEGORY_LIST){
  const added=QUESTION_BANK.slice(STARTER_QUESTION_COUNT).filter(q=>q.category===category.id);
  const expected=category.id==='braille'?24:12;
  assert.equal(added.length,expected,`${category.id} has ${expected} Migration 009 questions`);
}
assert.equal(QUESTION_BANK[73].id,'bq-en-0415','first safe expansion ID after the verified remote maximum');
assert.equal(QUESTION_BANK.at(-1).id,'bq-en-0666','final expansion ID');
const ids=new Set(QUESTION_BANK.map(q=>q.id));
assert.equal(ids.size,QUESTION_BANK.length,'unique stable question ids');
for(const q of QUESTION_BANK.slice(STARTER_QUESTION_COUNT))assert.match(q.sourceNote,/https:\/\//,`${q.id} source note`);

const source=['A','B','C','D'];
const deterministic=shuffled(source,max=>max-1);
assert.deepEqual(deterministic,source,'shuffle supports final index');
assert.notEqual(shuffled(source,()=>0),source,'shuffle can move the authored correct-first choice');
assert.deepEqual([...shuffled(source,()=>0)].sort(),source,'shuffle preserves every answer');

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
for(const id of ['home','auth','game','settings','results','announcer','assertive-announcer'])assert(html.includes(`id="${id.startsWith('announcer')?id:`view-${id}`}"`)||html.includes(`id="${id}"`),`required UI landmark ${id}`);
assert(html.includes('aria-live="polite"')&&html.includes('aria-live="assertive"'),'live regions');
assert(html.includes('id="recovery-form"')&&html.includes('Forgot Login ID?'),'login ID recovery UI');
assert(html.includes('Eight-character Login ID'),'Login ID field');
assert(!/<input[^>]*type="(?:email|password)"/i.test(html),'no email/password input fields');
assert(!html.includes('sfx-on'),'no unavailable sound-effect control');
const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
assert(css.includes(':focus-visible'),'visible focus indicator');
assert(css.includes('.high-contrast')&&css.includes('.large-text')&&css.includes('.reduce-motion'),'accessibility settings styles');
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
assert(!/(AudioContext|createOscillator)/.test(main),'no synthetic Web Audio effects');
assert(main.includes('displayAnswers:shuffled(q.answers)'),'answer choices are shuffled independently');
const migration=await readFile(new URL('../supabase/migrations/202609260001_core.sql',import.meta.url),'utf8');
for(const term of ['name_normalized text not null unique','login_id text not null unique','answer_hash text not null','enable row level security','bq_record_answer','unique(profile_id,question_id)'])assert(migration.includes(term),`schema requirement ${term}`);
const fn=await readFile(new URL('../supabase/functions/blind-quiz-api/index.ts',import.meta.url),'utf8');
for(const term of ['PBKDF2','310000','name_taken','loginId','bq_consume_attempt','token_hash','record-answer'])assert(fn.includes(term),`server feature ${term}`);
assert(!/secret answer.{0,50}console\.log/i.test(fn),'do not log secret answers');
const manifest=JSON.parse(await readFile(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
assert.equal(manifest.name.startsWith('Blind Quiz'),true);
console.log(`PASS: ${QUESTION_BANK.length} structured questions, ${CATEGORY_LIST.length} categories, shuffle/content/schema/security/accessibility source checks.`);
