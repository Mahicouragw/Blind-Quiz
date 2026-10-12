// Count Match pairs a spoken item/count clue with the matching fruit picture.
// The small item bank is deliberately local: it needs no external images or user data.

export const COUNT_MATCH_ROUNDS = [10, 20, 30, 50, 70];

const FRUIT_TYPES = [
  { id: 'apple', singular: 'apple', plural: 'apples', emoji: '🍎' },
  { id: 'banana', singular: 'banana', plural: 'bananas', emoji: '🍌' },
  { id: 'orange', singular: 'orange', plural: 'oranges', emoji: '🍊' },
  { id: 'strawberry', singular: 'strawberry', plural: 'strawberries', emoji: '🍓' },
  { id: 'grape', singular: 'grape', plural: 'grapes', emoji: '🍇' },
  { id: 'pear', singular: 'pear', plural: 'pears', emoji: '🍐' },
  { id: 'lemon', singular: 'lemon', plural: 'lemons', emoji: '🍋' },
];

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];

export const COUNT_MATCH_ITEMS = FRUIT_TYPES.flatMap(fruit =>
  Array.from({ length: 5 }, (_, index) => {
    const count = index + 1;
    const noun = count === 1 ? fruit.singular : fruit.plural;
    return {
      id: `${fruit.id}-${count}`,
      fruit: fruit.id,
      count,
      noun,
      label: `${count} ${noun[0].toUpperCase()}${noun.slice(1)}`,
      spoken: `${NUMBER_WORDS[count]} ${noun}`,
      emoji: fruit.emoji.repeat(count),
    };
  }),
);

function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Build a shuffled round list with four distinct fruit/count choices per clue. */
export function buildCountRounds(roundCount = 10, random = Math.random) {
  if (!COUNT_MATCH_ROUNDS.includes(Number(roundCount))) throw new Error('invalid_round_count');
  const rounds = [];
  let previousTarget = null;

  while (rounds.length < Number(roundCount)) {
    const targets = shuffle(COUNT_MATCH_ITEMS, random);
    if (targets.length > 1 && targets[0].id === previousTarget) {
      [targets[0], targets[1]] = [targets[1], targets[0]];
    }
    for (const target of targets) {
      if (rounds.length >= Number(roundCount)) break;
      const distractors = shuffle(COUNT_MATCH_ITEMS.filter(item => item.id !== target.id), random).slice(0, 3);
      rounds.push({
        target,
        options: shuffle([target, ...distractors], random),
      });
      previousTarget = target.id;
    }
  }
  return rounds;
}

export function createCountMatch(roundCount = 10, random = Math.random) {
  return {
    rounds: buildCountRounds(roundCount, random),
    roundIndex: 0,
    roundCount: Number(roundCount),
    score: 0,
    correct: 0,
    answered: 0,
    streak: 0,
    bestStreak: 0,
    answeredThisRound: false,
    done: false,
  };
}

/** Score one answer; every right answer earns at least 100 points and streaks add a small bonus. */
export function answerCountMatch(state, itemId) {
  if (!state || state.done || state.answeredThisRound) return { type: 'ignored' };
  const round = state.rounds[state.roundIndex];
  const choice = round?.options.find(item => item.id === itemId);
  if (!choice) return { type: 'ignored' };

  const correct = choice.id === round.target.id;
  state.answered += 1;
  state.answeredThisRound = true;
  let points = 0;
  if (correct) {
    state.correct += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    points = 100 + Math.min(state.streak - 1, 4) * 25;
    state.score += points;
  } else {
    state.streak = 0;
  }
  return { type: correct ? 'correct' : 'miss', target: round.target, choice, points, streak: state.streak };
}

/** Advance only after an answer; returns `done` on the last round. */
export function advanceCountMatch(state) {
  if (!state || state.done || !state.answeredThisRound) return { type: 'ignored' };
  if (state.roundIndex + 1 >= state.rounds.length) {
    state.done = true;
    return { type: 'done' };
  }
  state.roundIndex += 1;
  state.answeredThisRound = false;
  return { type: 'next', round: state.rounds[state.roundIndex], index: state.roundIndex };
}

export function countMatchAccuracy(correct, answered) {
  return answered > 0 ? Math.round((correct / answered) * 100) : 0;
}

/** A shareable route opens directly at the Count Match setup screen after the audio gate. */
export function countMatchUrl(currentUrl) {
  const url = new URL(currentUrl);
  url.searchParams.set('game', 'count-match');
  url.hash = '';
  return url.href;
}
