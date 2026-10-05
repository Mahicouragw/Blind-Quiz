// Letters to Words: puzzle engine (no DOM). Words come from src/words.js (SCOWL, see WORDS_LICENSE.md).
// Every puzzle is built from a real seed word, so it always has at least one answer, and it is only
// accepted when it holds enough common words for the level's goal.
import { WORD_TIERS } from './words.js';
import { SHORT_WORD_TIERS } from './short-words.js';

// Tier lists of 2-7 letter words (two-letter words come from src/short-words.js).
const TIERS = WORD_TIERS.map((t, i) => [...SHORT_WORD_TIERS[i].split(' '), ...t.split(' ')]);
const TIER_OF = new Map();
TIERS.forEach((words, i) => words.forEach(w => TIER_OF.set(w, i + 1)));
const ALL = [...TIER_OF.keys()];

// Level design: more letters, rarer seed words, and a larger goal as the player progresses.
// A level is played in rounds (one puzzle each). goal = words to find to complete the round.
// xp = level XP needed to level up automatically; each round earns word XP plus a round bonus.
// long = words of LONG_LEN+ letters that must be among the words found; hints = hints per round (unlimited when absent).
export const LONG_LEN = 5;
export const LEVELS = [
  { name: 'Beginner', letters: 4, seedTiers: [1], minCommon: 2, goal: 2, xp: 30, describe: '4 letters, find 2 words each round' },
  { name: 'Easy plus', letters: 5, seedTiers: [1], minCommon: 4, goal: 3, xp: 50, describe: '5 letters, find 3 words each round' },
  { name: 'Intermediate', letters: 5, seedTiers: [1, 2], minCommon: 5, goal: 4, xp: 75, describe: '5 letters, less common words, find 4 words each round' },
  { name: 'Intermediate plus', letters: 6, seedTiers: [1], minCommon: 7, goal: 5, xp: 100, describe: '6 letters, find 5 words each round' },
  { name: 'Advanced', letters: 6, seedTiers: [1, 2], minCommon: 8, goal: 6, xp: 125, describe: '6 letters, less common words, find 6 words each round' },
  { name: 'Expert', letters: 7, seedTiers: [1], minCommon: 10, goal: 7, xp: 150, describe: '7 letters, find 7 words each round' },
  { name: 'Master', letters: 7, seedTiers: [1, 2], minCommon: 12, goal: 8, xp: 175, describe: '7 letters, less common words, find 8 words each round' },
  { name: 'Word Hunter', letters: 7, seedTiers: [1, 2], minCommon: 13, goal: 9, xp: 200, hints: 5, describe: '7 letters, less common words, find 9 words each round, 5 hints per round' },
  { name: 'Sharp Ear', letters: 7, seedTiers: [1, 2], minCommon: 14, goal: 9, xp: 225, long: 1, hints: 5, describe: '7 letters, less common words, find 9 words each round, including 1 long word of 5 or more letters, 5 hints per round' },
  { name: 'Wordsmith', letters: 7, seedTiers: [1, 2, 3], minCommon: 15, goal: 10, xp: 250, long: 1, hints: 4, describe: '7 letters, rarer letter sets, find 10 words each round, including 1 long word of 5 or more letters, 4 hints per round' },
  { name: 'Puzzler', letters: 7, seedTiers: [1, 2, 3], minCommon: 16, goal: 10, xp: 275, long: 2, hints: 4, describe: '7 letters, rarer letter sets, find 10 words each round, including 2 long words of 5 or more letters, 4 hints per round' },
  { name: 'Lexicon', letters: 7, seedTiers: [1, 2, 3], minCommon: 17, goal: 11, xp: 300, long: 2, hints: 3, describe: '7 letters, rarer letter sets, find 11 words each round, including 2 long words of 5 or more letters, 3 hints per round' },
  { name: 'Champion', letters: 7, seedTiers: [1, 2, 3], minCommon: 18, goal: 12, xp: 330, long: 2, hints: 3, describe: '7 letters, rarer letter sets, find 12 words each round, including 2 long words of 5 or more letters, 3 hints per round' },
  { name: 'Virtuoso', letters: 7, seedTiers: [1, 2, 3], minCommon: 18, goal: 12, xp: 360, long: 3, hints: 2, describe: '7 letters, rarer letter sets, find 12 words each round, including 3 long words of 5 or more letters, 2 hints per round' },
  { name: 'Sage', letters: 7, seedTiers: [1, 2, 3], minCommon: 19, goal: 13, xp: 390, long: 3, hints: 2, describe: '7 letters, rarer letter sets, find 13 words each round, including 3 long words of 5 or more letters, 2 hints per round' },
  { name: 'Legend', letters: 7, seedTiers: [1, 2, 3], minCommon: 20, goal: 13, xp: 420, long: 3, hints: 1, describe: '7 letters, rarer letter sets, find 13 words each round, including 3 long words of 5 or more letters, 1 hint per round' },
  { name: 'Mythic', letters: 7, seedTiers: [1, 2, 3], minCommon: 21, goal: 14, xp: 450, long: 3, hints: 1, describe: '7 letters, rarer letter sets, find 14 words each round, including 3 long words of 5 or more letters, 1 hint per round' },
  { name: 'Titan', letters: 7, seedTiers: [1, 2, 3], minCommon: 22, goal: 14, xp: 480, long: 3, hints: 0, describe: '7 letters, rarer letter sets, find 14 words each round, including 3 long words of 5 or more letters, no hints' },
  { name: 'Grandmaster', letters: 7, seedTiers: [1, 2, 3], minCommon: 23, goal: 15, xp: 500, long: 3, hints: 0, describe: '7 letters, rarer letter sets, find 15 words each round, including 3 long words of 5 or more letters, no hints' },
  { name: 'Word Wizard', letters: 7, seedTiers: [1, 2, 3], minCommon: 24, goal: 16, xp: Infinity, long: 3, hints: 0, describe: '7 letters, rarer letter sets, find 16 words each round, including 3 long words of 5 or more letters, no hints' },
];
export const MAX_LEVEL = LEVELS.length;
/** XP a word is worth, the same scale the server uses: two letters 1 XP, otherwise 2-6 XP by length. */
export const wordXp = word => word.length <= 2 ? 1 : Math.min(6, Math.max(2, word.length - 1));
/** Bonus level XP for completing a round. */
export const roundBonus = level => 2 + Math.min(Math.max(1, level), LEVELS.length) * 2;
/** Adds round XP to the level progress and returns the new level and remaining progress (may skip no levels). */
export function applyLevelXp(level, levelXp, gained) {
  const rules = LEVELS[Math.min(Math.max(1, level), LEVELS.length) - 1];
  const total = levelXp + gained;
  if (level < LEVELS.length && total >= rules.xp) return { level: level + 1, levelXp: 0, levelledUp: true };
  return { level, levelXp: total, levelledUp: false };
}
export const levelRules = level => LEVELS[Math.min(Math.max(1, level), LEVELS.length) - 1];
export const tierOf = word => TIER_OF.get(word) || 0;
export const isWord = word => TIER_OF.has(word);

const counts = word => { const c = {}; for (const ch of word) c[ch] = (c[ch] || 0) + 1; return c; };
// A word fits when it uses each supplied letter at most as many times as it was supplied.
export function fits(word, letters) {
  const pool = counts(letters);
  for (const ch of word) { if (!pool[ch]) return false; pool[ch]--; }
  return true;
}
/** Every dictionary word (2+ letters) that can be built from the letters, longest first. */
export function solutionsFor(letters) {
  const out = ALL.filter(w => w.length <= letters.length && fits(w, letters));
  return out.sort((a, b) => b.length - a.length || a.localeCompare(b));
}
const keyOf = letters => [...letters].sort().join('');

/** Builds a puzzle for the level. `recent` holds sorted-letter keys that should not repeat. */
export function makePuzzle(level, { random = Math.random, recent = [] } = {}) {
  const rules = levelRules(level);
  const seeds = rules.seedTiers.flatMap(t => TIERS[t - 1]).filter(w => w.length === rules.letters);
  // Difficulty is judged on words of 3+ letters, so two-letter words are a bonus rather than the whole goal.
  const avoid = new Set(recent);
  let best = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const seed = seeds[Math.floor(random() * seeds.length)];
    const key = keyOf(seed);
    if (avoid.has(key) && attempt < 300) continue;
    const solutions = solutionsFor(seed);
    const common = solutions.filter(w => tierOf(w) <= 2);
    const longer = common.filter(w => w.length >= 3).length;
    const longCommon = common.filter(w => w.length >= LONG_LEN).length;
    const fitsLong = longCommon >= (rules.long || 0);
    const candidate = { seed, key, solutions, common, longer, longCommon, score: Math.min(longer, rules.minCommon) + (fitsLong ? 100 : 0) };
    if (!best || candidate.score > best.score) best = candidate;
    if (longer >= rules.minCommon && fitsLong) { best = candidate; break; }
  }
  const letters = shuffleLetters(best.seed.split(''), random, best.seed);
  return {
    level, letters, key: best.key,
    solutions: best.solutions,          // every accepted word (real dictionary words)
    common: best.common,                // the everyday words used for hints and the goal
    goal: Math.max(1, Math.min(rules.goal, best.common.length)),
    longGoal: Math.min(rules.long || 0, best.longCommon),  // long words (LONG_LEN+ letters) required to finish
    hints: rules.hints ?? Infinity,                        // hints left this round
  };
}
/** Shuffles the letters so they do not spell the seed word in order (when another order exists). */
export function shuffleLetters(letters, random = Math.random, avoid = '') {
  const out = [...letters];
  for (let tries = 0; tries < 10; tries++) {
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    if (out.join('') !== avoid || new Set(out).size === 1) break;
  }
  return out;
}
/** True when a longer, not-yet-found answer starts with these letters. */
export const canExtend = (word, solutions, found) => solutions.some(w => w.length > word.length && w.startsWith(word) && !found.has(w));
/** True when some answer starts with these letters. */
export const isPrefix = (word, solutions) => solutions.some(w => w.startsWith(word));
