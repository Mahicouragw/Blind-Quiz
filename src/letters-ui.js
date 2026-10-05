// Letters to Words: accessible game screen. Every letter is a real button; no typing, no drag and drop.
// Words are recognised automatically as the letters are chosen; the server verifies each found word and
// pays XP and coins the first time a player finds it.
import { makePuzzle, canExtend, isPrefix, shuffleLetters, levelRules } from './letters.js';

const STORE = 'bq.letters.v1';
const load = () => { try { const s = JSON.parse(localStorage.getItem(STORE) || '{}'); return { level: Math.max(1, Number(s.level) || 1), recent: Array.isArray(s.recent) ? s.recent.slice(-40) : [] }; } catch { return { level: 1, recent: [] }; } };
const save = s => { try { localStorage.setItem(STORE, JSON.stringify({ level: s.level, recent: s.recent.slice(-40) })); } catch { /* storage unavailable */ } };
const spell = word => word.toUpperCase().split('').join(' ');
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

export function createLettersGame({ $, announce, callApi, getSession, setSession, onProfile, playSfx }) {
  const game = { stored: load(), puzzle: null, picked: [], found: new Set(), streak: 0, score: 0, busy: Promise.resolve(), complete: false };
  const word = () => game.picked.map(i => game.puzzle.letters[i]).join('');

  function renderTiles() {
    const host = $('#letters-tiles');
    host.innerHTML = '';
    game.puzzle.letters.forEach((ch, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'letter-tile';
      b.textContent = ch.toUpperCase();
      b.dataset.index = String(i);
      b.setAttribute('aria-label', `Letter ${ch.toUpperCase()}`);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => pick(i));
      host.append(b);
    });
  }
  function renderState() {
    const w = word();
    game.puzzle.letters.forEach((_, i) => {
      const b = $(`#letters-tiles [data-index="${i}"]`);
      const on = game.picked.includes(i);
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('picked', on);
    });
    $('#letters-current').textContent = w ? `Your word: ${w.toUpperCase()}` : 'Your word: no letters chosen yet';
    const { goal, solutions } = game.puzzle;
    $('#letters-progress').textContent = `Words found: ${game.found.size} of ${goal} needed. ${solutions.length} words are possible. Score ${game.score}.`;
    const list = $('#letters-found');
    list.innerHTML = '';
    for (const f of [...game.found].reverse()) { const li = document.createElement('li'); li.textContent = f.toUpperCase(); list.append(li); }
    $('#letters-found-empty').hidden = game.found.size > 0;
    $('#letters-remove').setAttribute('aria-disabled', String(!w));
    $('#letters-clear').setAttribute('aria-disabled', String(!w));
  }
  function status(text, { urgent = false } = {}) { $('#letters-status').textContent = text; announce(text, urgent); }
  function lettersSentence() { return game.puzzle.letters.map(c => c.toUpperCase()).join(', '); }

  function start(level = game.stored.level) {
    game.stored.level = level;
    game.puzzle = makePuzzle(level, { recent: game.stored.recent });
    game.stored.recent.push(game.puzzle.key);
    save(game.stored);
    game.picked = []; game.found = new Set(); game.complete = false;
    const rules = levelRules(level);
    $('#letters-level').textContent = `Level ${level}. ${rules.letters} letters. Find ${game.puzzle.goal} words to open the next level.`;
    $('#letters-next').hidden = true;
    renderTiles(); renderState();
    const signedOut = !getSession() ? ' Sign in to earn XP and coins; you can still play.' : '';
    status(`Level ${level}. Your letters are ${lettersSentence()}. Choose letters to build a word of three or more letters. Find ${game.puzzle.goal} words.${signedOut}`);
  }

  function pick(i) {
    if (!game.puzzle) return;
    const ch = game.puzzle.letters[i].toUpperCase();
    if (game.picked.includes(i)) {
      if (game.picked[game.picked.length - 1] === i) { game.picked.pop(); renderState(); status(`${ch} removed. ${word() ? `Your word: ${spell(word())}.` : 'No letters chosen.'}`); }
      else status(`${ch} is already in your word. Use Remove last letter or Clear.`);
      return;
    }
    game.picked.push(i);
    playSfx('click');
    const w = word();
    renderState();
    const { solutions } = game.puzzle;
    if (w.length >= 3 && solutions.includes(w)) { foundWord(w); return; }
    if (isPrefix(w, solutions)) { status(`${ch} selected. Your word: ${spell(w)}.`); return; }
    game.streak = 0;
    playSfx('wrong');
    game.picked = [];
    renderState();
    status(`${spell(w)}. Not a valid word. Letters cleared, try again.`, { urgent: true });
  }

  function afterWord(w) {
    if (canExtend(w, game.puzzle.solutions, game.found)) return ' Keep adding letters for a longer word, or choose Clear.';
    game.picked = [];
    renderState();
    return '';
  }

  function foundWord(w) {
    if (game.found.has(w)) { status(`${w.toUpperCase()}, already found.${afterWord(w)}`); return; }
    game.found.add(w);
    game.streak++;
    game.score += w.length;
    playSfx('correct');
    const keep = afterWord(w);
    renderState();
    const letters = game.puzzle.letters.join('');
    const session = getSession();
    game.busy = game.busy.then(async () => {
      let reward = '';
      if (session) {
        try {
          const r = await withTimeout(callApi('record-word', { letters, word: w }), 6000);
          if (r.profile) { setSession({ ...getSession(), profile: r.profile }); onProfile(r.profile); }
          reward = r.alreadyFound ? ' You found this word in an earlier game, so no new XP.' : r.xp ? ` You earned ${r.xp} XP and ${r.coins} ${r.coins === 1 ? 'coin' : 'coins'}. Streak: ${r.profile?.currentStreak ?? game.streak}.` : '';
        } catch { reward = getSession() ? ' This word could not be saved to your profile right now.' : ' Your session has ended. Sign in again to keep earning XP.'; }
      } else reward = ` Streak: ${game.streak}.`;
      const progress = ` ${game.found.size} of ${game.puzzle.goal} found.`;
      status(`Word found: ${w.toUpperCase()}.${reward}${progress}${keep}`, { urgent: true });
      if (!game.complete && game.found.size >= game.puzzle.goal) levelComplete();
    });
  }

  function levelComplete() {
    game.complete = true;
    game.stored.level = game.puzzle.level + 1;
    save(game.stored);
    playSfx('applause');
    $('#letters-next').hidden = false;
    $('#letters-next').textContent = `Play level ${game.stored.level}`;
    setTimeout(() => {
      if ($('#view-letters').hidden) return; // the player already left the game
      status(`Level ${game.puzzle.level} complete! You can keep finding words here, or choose Play level ${game.stored.level}.`);
      $('#letters-next').focus();
    }, 1600);
  }

  function hint() {
    const left = game.puzzle.common.filter(w => !game.found.has(w));
    const pool = left.length ? left : game.puzzle.solutions.filter(w => !game.found.has(w));
    if (!pool.length) { status('You have found every word in these letters!'); return; }
    const h = pool[Math.floor(Math.random() * pool.length)];
    status(`Hint: a ${h.length}-letter word that starts with ${h[0].toUpperCase()}.`);
  }

  function wire() {
    $('#letters-remove').addEventListener('click', () => { if (!game.picked.length) { status('No letters chosen.'); return; } const i = game.picked.pop(); renderState(); status(`${game.puzzle.letters[i].toUpperCase()} removed. ${word() ? `Your word: ${spell(word())}.` : 'No letters chosen.'}`); });
    $('#letters-clear').addEventListener('click', () => { game.picked = []; renderState(); status('Letters cleared.'); });
    $('#letters-shuffle').addEventListener('click', () => { const chosen = game.picked.map(i => game.puzzle.letters[i]); game.puzzle.letters = shuffleLetters(game.puzzle.letters); game.picked = []; renderTiles(); renderState(); status(`Letters shuffled${chosen.length ? ' and your word cleared' : ''}. Your letters are ${lettersSentence()}.`); });
    $('#letters-hear').addEventListener('click', () => status(`Your letters are ${lettersSentence()}. ${word() ? `Your word so far: ${spell(word())}.` : ''} ${game.found.size} of ${game.puzzle.goal} words found.`));
    $('#letters-hint').addEventListener('click', hint);
    $('#letters-new').addEventListener('click', () => start(game.puzzle?.level || game.stored.level));
    $('#letters-next').addEventListener('click', () => start(game.stored.level));
  }
  return { start, wire, get state() { return game; } };
}
