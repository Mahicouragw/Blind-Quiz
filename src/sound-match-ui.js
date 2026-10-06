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

export function createSoundMatch({ $, announce, matchSounds, playMatchSound, stopMatchSound, playSfx, rnd = Math.random, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  const grid = $('#sm-grid'), status = $('#sm-status'), stats = $('#sm-stats'), finish = $('#sm-finish');
  let level = 'easy', state = null, busy = false, game = 0;

  const say = (text, urgent = false) => { status.textContent = text; announce(text, urgent); };
  const label = (card, extra = '') => `Number ${card.number}${extra}`;

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
      status.textContent = `Number ${number} is playing. Now find the number with the same sound.`;
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

  function finishGame() {
    const pairs = state.board.length / 2, tries = state.tries, stars = starsFor(pairs, tries);
    const best = readBest(), prev = best[level];
    const isBest = !prev || tries < prev;
    if (isBest) { best[level] = tries; saveBest(best); }
    const text = `You found all ${pairs} pairs in ${tries} tries! ${stars} star${stars === 1 ? '' : 's'}.${isBest ? ' New best score!' : ` Your best is ${prev} tries.`}`;
    finish.hidden = false;
    $('#sm-finish-text').textContent = text;
    $('#sm-finish-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    playSfx(stars === 3 ? 'cheer' : 'applause');
    say(text);
    setTimeout(() => $('#sm-again')?.focus(), 60);
  }

  async function start(nextLevel = level) {
    level = SM_LEVELS[nextLevel] ? nextLevel : 'easy';
    game += 1; busy = false; stopMatchSound();
    grid.removeAttribute('aria-busy');
    document.querySelectorAll('[data-sm-level]').forEach(b => { const on = b.dataset.smLevel === level; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    finish.hidden = true; grid.innerHTML = '';
    const pool = await matchSounds();
    const { pairs, label: name, describe } = SM_LEVELS[level];
    try { state = newMatchState(buildBoard(pairs, pool, rnd)); }
    catch { state = null; renderStats(); say('Sound Match needs its sounds. Please check your internet connection and try again.', true); return; }
    grid.dataset.size = String(pairs * 2);
    grid.append(...state.board.map(cardButton));
    renderStats();
    say(`${name}: ${describe}. Press a number to hear its sound, then find the other number with the same sound.`);
  }

  function wire() {
    document.querySelectorAll('[data-sm-level]').forEach(b => b.addEventListener('click', () => start(b.dataset.smLevel)));
    $('#sm-again')?.addEventListener('click', () => { start(level); setTimeout(() => btn(1)?.focus(), 60); });
    $('#sm-new')?.addEventListener('click', () => start(level));
  }

  return { start, wire, stop: () => { game += 1; stopMatchSound(); }, get state() { return state; }, get level() { return level; } };
}
