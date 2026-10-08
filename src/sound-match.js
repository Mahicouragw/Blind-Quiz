// Sound Match: a memory game played by ear. Numbered buttons each hide a recorded sound; every sound is
// hidden behind exactly two numbers. Press a number to hear its sound, then find the other number that
// plays the same sound. Pure game logic (no DOM), so it can be tested on its own.

export const SM_LEVELS = {
  easy: { pairs: 5, label: 'Easy', describe: 'Numbers 1 to 10, 5 pairs of sounds' },
  medium: { pairs: 8, label: 'Medium', describe: 'Numbers 1 to 16, 8 pairs of sounds' },
  hard: { pairs: 10, label: 'Hard', describe: 'Numbers 1 to 20, 10 pairs of sounds' },
};

function shuffle(list, rnd) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Picks `pairs` different sounds (mixing moods where possible) and hides each behind two numbers. */
export function buildBoard(pairs, pool, rnd = Math.random) {
  if (!Array.isArray(pool) || pool.length < pairs) throw new Error('not_enough_sounds');
  // Round-robin across moods so a board mixes funny, mysterious, cinematic and interesting sounds.
  const byMood = new Map();
  for (const s of shuffle(pool, rnd)) { if (!byMood.has(s.mood)) byMood.set(s.mood, []); byMood.get(s.mood).push(s); }
  const moods = shuffle([...byMood.keys()], rnd), chosen = [];
  while (chosen.length < pairs) for (const m of moods) { const s = byMood.get(m).shift(); if (s && chosen.length < pairs) chosen.push(s); }
  return shuffle([...chosen, ...chosen], rnd).map((sound, i) => ({ number: i + 1, sound }));
}

export function newMatchState(board) {
  return { board, open: null, matched: new Set(), tries: 0, done: false };
}

/**
 * Applies a press on a number (1-based). Returns what happened:
 *  first   - first number of a try is now open
 *  replay  - the open number (or an already matched one) was pressed again; just play it again
 *  match   - second number plays the same sound; both stay found
 *  miss    - second number plays a different sound; both close again
 */
export function press(state, number) {
  const card = state.board[number - 1];
  if (!card || state.done) return { type: 'ignored' };
  if (state.matched.has(number) || state.open === number) return { type: 'replay', card };
  if (state.open === null) { state.open = number; return { type: 'first', card }; }
  const first = state.board[state.open - 1];
  state.open = null;
  state.tries += 1;
  if (first.sound.slot === card.sound.slot) {
    state.matched.add(first.number); state.matched.add(card.number);
    state.done = state.matched.size === state.board.length;
    return { type: 'match', first, card, done: state.done };
  }
  return { type: 'miss', first, card };
}

/** Stars for a finished board: a perfect memory needs exactly `pairs` tries. */
export function starsFor(pairs, tries) {
  if (tries <= Math.ceil(pairs * 1.6)) return 3;
  if (tries <= pairs * 2.5) return 2;
  return 1;
}
