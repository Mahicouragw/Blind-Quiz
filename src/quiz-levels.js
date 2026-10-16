export const ROUND_LENGTHS = [5, 10, 15];
export const QUIZ_STAGES = Array.from({ length: 12 }, (_, index) => {
  const band = Math.floor(index / 3);
  return {
    id: index + 1,
    difficulty: ['easy', 'medium', 'hard', 'expert'][band],
    roundLength: ROUND_LENGTHS[index % ROUND_LENGTHS.length],
  };
});

export function questionMatchesDifficulty(question, difficulty = 'all') {
  if (difficulty === 'all' || !difficulty) return true;
  if (difficulty === 'expert') return question?.difficulty === 'expert' || question?.difficulty === 'hard';
  return question?.difficulty === difficulty;
}

export function normalizedUnlockedStage(value) {
  const stage = Number(value);
  return Number.isInteger(stage) ? Math.max(1, Math.min(QUIZ_STAGES.length, stage)) : 1;
}

export function stagePasses(score, total) {
  return total > 0 && Number(score) >= Math.ceil(Number(total) * 0.7);
}
