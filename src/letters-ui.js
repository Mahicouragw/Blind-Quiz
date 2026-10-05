// Letters to Words: accessible game screen. Every letter is a real button; no typing, no drag and drop.
// Words are recognised automatically as the letters are chosen; the server verifies each found word and
// pays XP and coins the first time a player finds it.
import { makePuzzle, canExtend, isPrefix, shuffleLetters, levelRules, wordXp, roundBonus, applyLevelXp, MAX_LEVEL } from './letters.js';

const STORE = 'bq.letters.v1';
// Game progress on this device: level, level XP towards the next level, round number within the level.
const num = (v, min, max) => Math.min(max, Math.max(min, Math.floor(Number(v) || 0)));
const load = () => { try { const s = JSON.parse(localStorage.getItem(STORE) || '{}'); return { level: num(s.level, 1, MAX_LEVEL), levelXp: num(s.levelXp, 0, 1e6), round: num(s.round, 1, 1e6), recent: Array.isArray(s.recent) ? s.recent.slice(-40) : [] }; } catch { return { level: 1, levelXp: 0, round: 1, recent: [] }; } };
const save = s => { try { localStorage.setItem(STORE, JSON.stringify({ level: s.level, levelXp: s.levelXp, round: s.round, recent: s.recent.slice(-40) })); } catch { /* storage unavailable */ } };
const spell = word => word.toUpperCase().split('').join(' ');
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

export function createLettersGame({ $, announce, callApi, getSession, setSession, onProfile, playSfx, playSequence = slots => playSfx(slots[0]) }) {
  const game = { stored: load(), puzzle: null, picked: [], found: new Set(), streak: 0, score: 0, busy: Promise.resolve(), complete: false, roundXp: 0, roundCoins: 0, roundProfileXp: 0 };
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
      b.addEventListener('click', () => pick(i));
      host.append(b);
    });
  }
  function renderState() {
    const w = word();
    game.puzzle.letters.forEach((_, i) => {
      const b = $(`#letters-tiles [data-index="${i}"]`);
      const on = game.picked.includes(i);
      b.setAttribute('aria-label', `Letter ${game.puzzle.letters[i].toUpperCase()}${on ? ', selected' : ''}`);
      b.classList.toggle('picked', on);
    });
    $('#letters-current').textContent = w ? `Your word: ${w.toUpperCase()}` : 'Your word: no letters chosen yet';
    const { goal, solutions } = game.puzzle;
    $('#letters-progress').textContent = `Words found: ${game.found.size} of ${goal} needed. ${solutions.length} words are possible. Score ${game.score}.`;
    const list = $('#letters-found');
    list.innerHTML = '';
    for (const f of [...game.found].reverse()) { const li = document.createElement('li'); li.textContent = f.toUpperCase(); list.append(li); }
    $('#letters-found-empty').hidden = game.found.size > 0;
    renderXp();
    $('#letters-remove').setAttribute('aria-disabled', String(!w));
    $('#letters-clear').setAttribute('aria-disabled', String(!w));
  }
  function xpLine() {
    const { level, levelXp } = game.stored;
    if (level >= MAX_LEVEL) return `Level XP: ${levelXp}. You are at the top level.`;
    const need = levelRules(level).xp;
    return `Level XP: ${levelXp} of ${need}. ${Math.max(0, need - levelXp)} more to reach Level ${level + 1}.`;
  }
  function renderXp() {
    const { level, levelXp } = game.stored;
    $('#letters-xp').textContent = xpLine();
    const pct = level >= MAX_LEVEL ? 100 : Math.min(100, Math.round(levelXp / levelRules(level).xp * 100));
    $('#letters-xp-meter').style.width = `${pct}%`;
  }
  function status(text, { urgent = false } = {}) { $('#letters-status').textContent = text; announce(text, urgent); }
  // Round results and level-ups move focus to the status text, so TalkBack reads them once from there.
  function focusStatus(text) {
    const el = $('#letters-status');
    el.textContent = text;
    el.tabIndex = -1;
    setTimeout(() => { if (!$('#view-letters').hidden) el.focus(); }, 60);
  }
  function lettersSentence() { return game.puzzle.letters.map(c => c.toUpperCase()).join(', '); }

  function setupPuzzle(level) {
    game.stored.level = level;
    game.puzzle = makePuzzle(level, { recent: game.stored.recent });
    game.stored.recent.push(game.puzzle.key);
    save(game.stored);
    game.picked = []; game.found = new Set(); game.complete = false; game.roundXp = 0; game.roundCoins = 0; game.roundProfileXp = 0;
    const rules = levelRules(level);
    $('#letters-level').textContent = `Level ${level}, ${rules.name}. Round ${game.stored.round}. ${rules.letters} letters. Find ${game.puzzle.goal} words to complete the round.`;
    renderTiles(); renderState();
    return `Round ${game.stored.round}. Your letters are ${lettersSentence()}. Find ${game.puzzle.goal} words.`;
  }
  function start(level = game.stored.level) {
    const intro = setupPuzzle(level);
    const signedOut = !getSession() ? ' Sign in to earn XP and coins; you can still play.' : '';
    status(`Level ${level}, ${levelRules(level).name}. ${intro} Choose letters to build a word of two or more letters.${signedOut}`);
  }

  function pick(i) {
    if (!game.puzzle) return;
    const ch = game.puzzle.letters[i].toUpperCase();
    if (game.picked.includes(i)) {
      // With TalkBack, focus stays on the letter just pressed, so pressing it again means "this letter again":
      // use another unused copy of the same letter (T, O, O makes TOO). Removing is only done by Remove last letter.
      const twin = game.puzzle.letters.findIndex((c, k) => c === game.puzzle.letters[i] && !game.picked.includes(k));
      if (twin < 0) { status(`${ch} is already used, and there is no other ${ch}. Your word: ${spell(word())}. Use Remove last letter or Clear to change it.`); return; }
      i = twin;
    }
    game.picked.push(i);
    playSfx('click');
    const w = word();
    renderState();
    const { solutions } = game.puzzle;
    if (w.length >= 2 && solutions.includes(w)) { foundWord(w); return; }
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
    game.roundXp += wordXp(w);
    const roundDone = !game.complete && game.found.size >= game.puzzle.goal;
    if (roundDone) game.complete = true; // later words in this puzzle cannot complete the round twice
    if (!roundDone) playSfx('correct');
    const keep = afterWord(w);
    renderState();
    const letters = game.puzzle.letters.join('');
    const session = getSession();
    const prevProfileLevel = session?.profile?.level;
    game.busy = game.busy.then(async () => {
      let reward = '', profileUp = 0;
      if (session) {
        try {
          const r = await withTimeout(callApi('record-word', { letters, word: w }), 6000);
          if (r.profile) { setSession({ ...getSession(), profile: r.profile }); onProfile(r.profile); }
          if (r.xp) { game.roundProfileXp += r.xp; game.roundCoins += r.coins || 0; }
          if (r.profile && prevProfileLevel && r.profile.level > prevProfileLevel) profileUp = r.profile.level;
          reward = r.alreadyFound ? ' You found this word in an earlier game, so no new profile XP.' : r.xp ? ` You earned ${r.xp} XP and ${r.coins} ${r.coins === 1 ? 'coin' : 'coins'}. Streak: ${r.profile?.currentStreak ?? game.streak}.` : '';
          if (!roundDone && r.xp) playSequence(profileUp ? ['coin', 'levelup'] : ['coin']);
        } catch { reward = getSession() ? ' This word could not be saved to your profile right now.' : ' Your session has ended. Sign in again to keep earning XP.'; }
      } else reward = ` Streak: ${game.streak}.`;
      const profileLine = profileUp ? ` Profile level up! You reached profile level ${profileUp}.` : '';
      if (roundDone) { roundComplete(`Word found: ${w.toUpperCase()}.${reward}${profileLine}`, profileUp); return; }
      status(`Word found: ${w.toUpperCase()}.${reward}${profileLine} ${game.found.size} of ${game.puzzle.goal} found.${keep}`, { urgent: true });
    });
  }

  // Round complete: add word XP plus the round bonus to the level XP. When the level XP reaches the
  // level's target the player levels up automatically and the next, harder round starts straight away.
  function roundComplete(wordLine, profileUp) {
    const level = game.puzzle.level, bonus = roundBonus(level), gained = game.roundXp + bonus;
    const res = applyLevelXp(level, game.stored.levelXp, gained);
    const coins = game.roundCoins ? ` ${game.roundProfileXp} profile XP and ${game.roundCoins} ${game.roundCoins === 1 ? 'coin' : 'coins'} earned this round.` : '';
    let text = `${wordLine} Round complete! ${game.found.size} words found. ${gained} level XP earned, including a ${bonus} XP round bonus.${coins}`;
    playSequence(res.levelledUp || profileUp ? ['applause', 'levelup'] : ['applause']);
    game.stored.levelXp = res.levelXp;
    if (res.levelledUp) {
      const rules = levelRules(res.level);
      game.stored.round = 1;
      text += ` Level up! You are now Level ${res.level}, ${rules.name}. Now: ${rules.describe}.`;
    } else {
      game.stored.round += 1;
      text += ` ${xpLine()}`;
    }
    save(game.stored);
    if ($('#view-letters').hidden) return; // the player already left; the next round starts when they return
    text += ` Next: ${setupPuzzle(res.level)}`;
    focusStatus(text);
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
  }
  return { start, wire, get state() { return game; } };
}
