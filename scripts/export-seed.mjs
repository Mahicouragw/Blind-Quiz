import { writeFile } from 'node:fs/promises';
import { QUESTION_BANK, STARTER_QUESTION_COUNT, validateQuestionBank } from '../src/content.js';

const errors=validateQuestionBank();
if(errors.length)throw new Error(errors.join('\n'));
const sqlQuote=s=>`'${String(s).replaceAll("'","''")}'`;
const insert=q=>`insert into public.bq_questions(id,category,subcategory,difficulty,mode,question,answers,correct_answer,explanation,xp_reward,coin_reward,tags,language,active,source_note) values (${sqlQuote(q.id)},${sqlQuote(q.category)},${sqlQuote(q.subcategory)},${sqlQuote(q.difficulty)},${sqlQuote(q.mode)},${sqlQuote(q.question)},${sqlQuote(JSON.stringify(q.answers))}::jsonb,${sqlQuote(q.correctAnswer)},${sqlQuote(q.explanation)},${q.xp},${q.coins},array[${q.tags.map(sqlQuote).join(',')}],${sqlQuote(q.language)},${q.active},${sqlQuote(q.sourceNote)})`;
const update=' on conflict(id) do update set category=excluded.category,subcategory=excluded.subcategory,difficulty=excluded.difficulty,mode=excluded.mode,question=excluded.question,answers=excluded.answers,correct_answer=excluded.correct_answer,explanation=excluded.explanation,xp_reward=excluded.xp_reward,coin_reward=excluded.coin_reward,tags=excluded.tags,language=excluded.language,active=excluded.active,source_note=excluded.source_note;';
const seed=QUESTION_BANK.map(q=>insert(q)+update).join('\n');
await writeFile(new URL('../supabase/seed.sql',import.meta.url),`-- Generated only after content validation. Run after the core migration.\nbegin;\n${seed}\ncommit;\n`);
const added=QUESTION_BANK.slice(STARTER_QUESTION_COUNT);
const migration=added.map(q=>insert(q)+';').join('\n');
await writeFile(new URL('../supabase/migrations/202610030009_expand_question_bank.sql',import.meta.url),`-- Migration 009: add ${added.length} reviewed questions. Apply once after migrations 001-008.\n-- Prepared 2026-10-03; application must be confirmed by the project owner.\nbegin;\n${migration}\ncommit;\n`);
console.log(`Wrote ${QUESTION_BANK.length} validated seed questions and Migration 009 with ${added.length} new rows.`);
