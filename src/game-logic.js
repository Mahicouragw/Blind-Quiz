import { shuffled } from './random.js';

export const GAME_MODES = [
  ['classic', 'Classic Quiz', 'A balanced mix from different categories.'],
  ['rapid', 'Rapid Fire', 'Eight questions with a 15-second clock.'],
  ['timeattack', 'Time Attack', 'Ten questions with a 10-second clock.'],
  ['survival', 'Survival', 'Keep your run alive; one miss ends it.'],
  ['random', 'Random Mix', 'Questions drawn from the full playable pack.'],
  ['vocabulary', 'Vocabulary', 'Meanings, context, and spelling.'],
  ['abbreviations', 'Abbreviations', 'Decode common short forms.'],
  ['braille', 'Braille', 'Explore letters through six-dot patterns.'],
];

export function poolFor(questionBank, category, mode) {
  let pool = questionBank.filter(question => category === 'general' || question.category === category);
  if (mode === 'vocabulary') pool = pool.filter(question => question.category === 'vocabulary');
  if (mode === 'abbreviations') pool = pool.filter(question => question.category === 'abbreviations');
  if (mode === 'braille') pool = pool.filter(question => question.category === 'braille');
  return pool;
}

function questionLimit(mode, poolSize) {
  if (mode === 'rapid') return 8;
  if (mode === 'timeattack') return 10;
  if (mode === 'survival') return 20;
  return Math.min(10, poolSize);
}

export function selectRoundQuestions(questionBank, category = 'general', mode = 'classic', shuffle = shuffled) {
  const pool = poolFor(questionBank, category, mode);
  if (!pool.length) return [];

  const limit = questionLimit(mode, pool.length);
  if (mode === 'classic' && category === 'general') {
    const categories = shuffle([...new Set(pool.map(question => question.category))]);
    const selected = categories.slice(0, limit).map(id => {
      const categoryPool = pool.filter(question => question.category === id);
      return shuffle(categoryPool)[0];
    });
    return shuffle(selected);
  }
  return shuffle(pool).slice(0, limit);
}

export function timeLimitFor(mode, configuredSeconds = 0) {
  if (mode === 'rapid') return 15;
  if (mode === 'timeattack') return 10;
  const seconds = Number(configuredSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function endsAfterMiss(mode, correct) {
  return mode === 'survival' && !correct;
}
