// Sound Match screen: level choice, the numbered board, spoken/visible status, and the finish summary.
import { SM_LEVELS, buildBoard, newMatchState, press, starsFor } from './sound-match.js';

const BEST_KEY = 'blindquiz.soundmatch.best.v1';
const readBest = () => { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {}; } catch { return {}; } };
const saveBest = b => { try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* storage full or blocked */ } };

// Waits until a clip finishes (or a safety timeout), so the second sound of a try is heard in full.
function untilEnded(a, maxMs = 3300) {
  return new Promise(resolve => {
    if (!a) { setTimeout(resolve, 700); return; }
    const t = setTimeout(resolve, maxMs);
    a.addEventListener('ended', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export function createSoundMatch({ $, announce, matchSounds, playMatchSound, stopMatchSound, playSfx, callApi = null, getSession = () => null, setSession = () => {}, onProfile = () => {}, rnd = Math.random, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  const grid = $('#sm-grid'), status = $('#sm-status'), stats = $('#sm-stats'), finish = $('#sm-finish');
  const startButton = $('#sm-start'), newButton = $('#sm-new');
  let level = 'easy', state = null, busy = false, game = 0, serverGame = null;

  const say = (text, urgent = false) => { status.textContent = text; announce(text, urgent); };
  const label = (card, extra = '') => `Number ${card.number}${extra}`;
  const levelButtons = () => [...document.querySelectorAll('[data-sm-level]')];

  function selectLevel(nextLevel = level) {
    level = SM_LEVELS[nextLevel] ? nextLevel : 'easy';
    game += 1; busy = false; state = null; serverGame = null; stopMatchSound();
    grid.removeAttribute('aria-busy'); grid.hidden = true; grid.innerHTML = '';
    stats.hidden = true; stats.textContent = ''; finish.hidden = true;
    startButton.hidden = false; startButton.disabled = false; startButton.textContent = 'Start Game';
    newButton.hidden = true;
    levelButtons().forEach(b => { const on = b.dataset.smLevel === level; b.disabled = false; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    say(`${SM_LEVELS[level].label} selected. Press Start Game to begin.`);
  }

  function renderStats() {
    if (!state) { stats.textContent = ''; return; }
    const pairs = state.board.length / 2;
    stats.textContent = `Pairs found: ${state.matched.size / 2} of ${pairs} · Tries: ${state.tries}`;
  }

  function cardButton(card) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sm-card'; b.dataset.number = String(card.number);
    b.innerHTML = `<span class="sm-num">${card.number}</span><span class="sm-name" aria-hidden="true"></span>`;
    b.setAttribute('aria-label', label(card));
    b.addEventListener('click', () => onPress(card.number));
    return b;
  }
  const btn = n => grid.querySelector(`[data-number="${n}"]`);
  function markOpen(n, on) { const b = btn(n); if (!b) return; b.classList.toggle('open', on); b.setAttribute('aria-label', label(state.board[n - 1], on ? ', playing' : '')); }
  function markMatched(card) {
    const b = btn(card.number); if (!b) return;
    b.classList.remove('open'); b.classList.add('matched');
    b.querySelector('.sm-name').textContent = card.sound.name;
    b.setAttribute('aria-label', label(card, `, found: ${card.sound.name}`));
  }

  async function onPress(number) {
    if (!state || busy) return;
    const myGame = game;
    const r = press(state, number);
    if (r.type === 'ignored') return;
    if (r.type === 'replay') { await playMatchSound(r.card.sound.slot); return; }
    if (r.type === 'first') {
      grid.querySelectorAll('.sm-card.open').forEach(b => markOpen(Number(b.dataset.number), false));
      markOpen(number, true);
      // The status line is not a live region: every message goes through say(), so a screen reader
      // reads each line once instead of twice.
      say(`Number ${number} is playing. Now find the number with the same sound.`);
      const a = await playMatchSound(r.card.sound.slot);
      if (!a) say('The sound could not play. Check your volume and internet connection, then try again.', true);
      return;
    }
    // Second number of a try: let it play out, then reveal the result.
    busy = true; grid.setAttribute('aria-busy', 'true');
    markOpen(number, true);
    const a = await playMatchSound(r.card.sound.slot);
    await untilEnded(a);
    if (myGame !== game) return; // a new game started meanwhile
    if (r.type === 'match') {
      markMatched(r.first); markMatched(r.card);
      playSfx('correct');
      renderStats();
      if (r.done) { busy = false; grid.removeAttribute('aria-busy'); finishGame(); return; }
      say(`Match! ${r.first.number} and ${r.card.number} are both ${r.card.sound.name}.`);
    } else {
      playSfx('wrong');
      say(`Not a match. ${r.first.number} and ${r.card.number} play different sounds.`);
      await wait(500);
      if (myGame !== game) return;
      markOpen(r.first.number, false); markOpen(r.card.number, false);
      renderStats();
    }
    busy = false; grid.removeAttribute('aria-busy');
  }

  // Signed-in players get XP and coins, checked and paid by the server (Migration 018).
  async function reward(tries, myGame) {
    if (!callApi || !getSession()) return ' Sign in to earn XP and coins.';
    const id = await serverGame;
    if (!id || myGame !== game) return '';
    try {
      const before = getSession()?.profile?.level;
      const r = await callApi('soundmatch-finish', { gameId: id, tries });
      if (r.profile) { setSession({ ...getSession(), profile: r.profile }); onProfile(r.profile); }
      if (r.dailyLimit) return " You have reached today's limit for Sound Match rewards.";
      if (!(r.xp > 0 || r.coins > 0)) return '';
      playSfx('coin');
      const up = before && r.profile?.level > before ? ` Level up! You are now Level ${r.profile.level}.` : '';
      // The level-up fanfare is a recorded Mixkit effect, the same one the quiz and Letters to Words use.
      if (up) playSfx('levelup');
      return ` You earned ${r.xp} XP and ${r.coins} coin${r.coins === 1 ? '' : 's'}.${up}`;
    } catch { return ''; }
  }

  async function finishGame() {
    const myGame = game;
    const pairs = state.board.length / 2, tries = state.tries, stars = starsFor(pairs, tries);
    const best = readBest(), prev = best[level];
    const isBest = !prev || tries < prev;
    if (isBest) { best[level] = tries; saveBest(best); }
    const earned = await reward(tries, myGame);
    if (myGame !== game) return;
    const text = `You found all ${pairs} pairs in ${tries} tries! ${stars} star${stars === 1 ? '' : 's'}.${isBest ? ' New best score!' : ` Your best is ${prev} tries.`}${earned}`;
    finish.hidden = false;
    $('#sm-finish-text').textContent = text;
    $('#sm-finish-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    playSfx(stars === 3 ? 'cheer' : 'applause');
    levelButtons().forEach(b => { b.disabled = false; });
    say(text);
    setTimeout(() => $('#sm-again')?.focus(), 60);
  }

  async function start(nextLevel = level) {
    level = SM_LEVELS[nextLevel] ? nextLevel : 'easy';
    const myGame = ++game, { pairs, label: name, describe } = SM_LEVELS[level];
    busy = false; state = null; serverGame = null; stopMatchSound();
    grid.removeAttribute('aria-busy'); grid.hidden = true; grid.innerHTML = '';
    stats.hidden = true; stats.textContent = ''; finish.hidden = true;
    startButton.hidden = false; startButton.disabled = true; startButton.textContent = 'Loading sounds…'; newButton.hidden = true;
    levelButtons().forEach(b => { const on = b.dataset.smLevel === level; b.disabled = true; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    say(`${name} selected. Loading sounds.`);
    let pool;
    try {
      pool = await matchSounds();
      if (myGame !== game) return;
      state = newMatchState(buildBoard(pairs, pool, rnd));
    } catch {
      if (myGame !== game) return;
      state = null; startButton.disabled = false; startButton.textContent = 'Start Game';
      levelButtons().forEach(b => { b.disabled = false; });
      say('Sound Match needs its sounds. Please check your internet connection and try again.', true);
      return;
    }
    // Register the game with the server (signed-in players only); the board never waits for it.
    serverGame = callApi && getSession() ? callApi('soundmatch-start', { level }).then(d => d.gameId || null).catch(() => null) : null;
    grid.dataset.size = String(pairs * 2);
    grid.append(...state.board.map(cardButton));
    grid.hidden = false; stats.hidden = false; newButton.hidden = false;
    startButton.hidden = true; startButton.disabled = false; startButton.textContent = 'Start Game';
    renderStats();
    say(`${name}: ${describe}. Press a number to hear its sound, then find the other number with the same sound.`);
    setTimeout(() => btn(1)?.focus(), 60);
  }

  function wire() {
    levelButtons().forEach(b => b.addEventListener('click', () => selectLevel(b.dataset.smLevel)));
    startButton?.addEventListener('click', () => start(level));
    $('#sm-again')?.addEventListener('click', () => selectLevel(level));
    newButton?.addEventListener('click', () => selectLevel(level));
  }

  return { start, selectLevel, wire, stop: () => { game += 1; stopMatchSound(); }, get state() { return state; }, get level() { return level; } };
}
