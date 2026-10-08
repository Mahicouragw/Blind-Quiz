import { writeFile } from 'node:fs/promises';
import {
  QUESTION_BANK,
  CATEGORY_LIST,
  STARTER_QUESTION_COUNT,
  MIGRATION_009_QUESTION_COUNT,
  MIGRATION_010_QUESTION_COUNT,
  validateQuestionBank,
} from '../src/content.js';

const errors = validateQuestionBank();
if (errors.length) throw new Error(errors.join('\n'));
if (MIGRATION_009_QUESTION_COUNT !== 252) {
  throw new Error(`Migration 009 must stay at 252 historical rows; found ${MIGRATION_009_QUESTION_COUNT}.`);
}
if (MIGRATION_010_QUESTION_COUNT !== 500) {
  throw new Error(`Migration 010 must contain exactly 500 new rows; found ${MIGRATION_010_QUESTION_COUNT}.`);
}
const added = QUESTION_BANK.slice(STARTER_QUESTION_COUNT + MIGRATION_009_QUESTION_COUNT);
if (added[0]?.id !== 'bq-en-0667' || added.at(-1)?.id !== 'bq-en-1166') {
  throw new Error('Migration 010 question IDs must remain bq-en-0667 through bq-en-1166.');
}
for (const category of CATEGORY_LIST) {
  const count = added.filter(question => question.category === category.id).length;
  if (count !== 20) throw new Error(`${category.id} must receive exactly 20 Migration 010 questions; found ${count}.`);
}

const sqlQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const insert = question => `insert into public.bq_questions(id,category,subcategory,difficulty,mode,question,answers,correct_answer,explanation,xp_reward,coin_reward,tags,language,active,source_note) values (${sqlQuote(question.id)},${sqlQuote(question.category)},${sqlQuote(question.subcategory)},${sqlQuote(question.difficulty)},${sqlQuote(question.mode)},${sqlQuote(question.question)},${sqlQuote(JSON.stringify(question.answers))}::jsonb,${sqlQuote(question.correctAnswer)},${sqlQuote(question.explanation)},${question.xp},${question.coins},array[${question.tags.map(sqlQuote).join(',')}],${sqlQuote(question.language)},${question.active},${sqlQuote(question.sourceNote)})`;
const update = ' on conflict(id) do update set category=excluded.category,subcategory=excluded.subcategory,difficulty=excluded.difficulty,mode=excluded.mode,question=excluded.question,answers=excluded.answers,correct_answer=excluded.correct_answer,explanation=excluded.explanation,xp_reward=excluded.xp_reward,coin_reward=excluded.coin_reward,tags=excluded.tags,language=excluded.language,active=excluded.active,source_note=excluded.source_note;';
const seed = QUESTION_BANK.map(question => `${insert(question)}${update}`).join('\n');
await writeFile(
  new URL('../supabase/seed.sql', import.meta.url),
  `-- Generated only after content validation. Run after the core migration.\nbegin;\n${seed}\ncommit;\n`,
);

// Migration 009 is applied remotely. Never regenerate or modify it here.
const migration = added.map(question => `${insert(question)};`).join('\n');
await writeFile(
  new URL('../supabase/migrations/202610070010_expand_question_bank.sql', import.meta.url),
  `-- Migration 010: add ${added.length} authored questions, 20 in each of 25 categories.\n-- Prepared 2026-10-07. Apply once, after Migration 009, after reviewing content and database IDs.\nbegin;\n${migration}\ncommit;\n`,
);
console.log(`Wrote ${QUESTION_BANK.length} validated seed questions and Migration 010 with ${added.length} new rows. Migration 009 was left unchanged.`);
