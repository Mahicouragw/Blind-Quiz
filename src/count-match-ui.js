// Count Match UI: spoken fruit/count clues, four visual choices, a local scorecard, and share links.
import {
  COUNT_MATCH_ROUNDS, advanceCountMatch, answerCountMatch, countMatchAccuracy,
  countMatchUrl, createCountMatch as createCountMatchState,
} from './count-match.js';

const BEST_KEY = 'blindquiz.countmatch.best.v1';

function readBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {}; }
  catch { return {}; }
}

function saveBest(best) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); }
  catch { /* private browsing or storage full: the game still works */ }
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function getSpeech() {
  const host = globalThis.window;
  return {
    synth: globalThis.speechSynthesis || host?.speechSynthesis,
    Utterance: globalThis.SpeechSynthesisUtterance || host?.SpeechSynthesisUtterance,
  };
}

function defaultOpenExternal(url) {
  const host = globalThis.window;
  if (!host) return;
  const userAgent = globalThis.navigator?.userAgent || host.navigator?.userAgent || '';
  if (/;\s*wv\)/i.test(userAgent)) {
    // The Flutter WebView opens external HTTPS navigation in the system browser.
    host.location.assign(url);
    return;
  }
  const popup = host.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) host.location.assign(url);
}

async function copyText(value) {
  const nav = globalThis.navigator || globalThis.window?.navigator;
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(value);
      return true;
    }
  } catch { /* use the selection fallback below */ }

  const doc = globalThis.document || globalThis.window?.document;
  if (!doc?.body) return false;
  const field = doc.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  doc.body.append(field);
  field.select();
  let copied = false;
  try { copied = !!doc.execCommand?.('copy'); } catch { copied = false; }
  field.remove();
  return copied;
}

function shareLinks(currentUrl, scoreText) {
  const url = countMatchUrl(currentUrl);
  return {
    url,
    text: `${scoreText} Can you beat me? Play Count Match: ${url}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${scoreText} Can you beat me? ${url}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(scoreText)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${scoreText} Can you beat me?`)}&url=${encodeURIComponent(url)}`,
  };
}

export function createCountMatch({
  $, announce = () => {}, playSfx = () => {}, unlockAudio = () => Promise.resolve(false),
  openExternal = defaultOpenExternal, rnd = Math.random, now = () => Date.now(),
} = {}) {
  const setup = $('#cm-setup');
  const gameView = $('#cm-game');
  const scorecard = $('#cm-scorecard');
  const roundSelect = $('#cm-round-count');
  const options = $('#cm-options');
  const prompt = $('#cm-prompt');
  const status = $('#cm-status');
  const nextButton = $('#cm-next');
  const textClue = $('#cm-text-clue');
  const revealButton = $('#cm-reveal-clue');
  let state = null;
  let startedAt = 0;
  let finalCard = null;

  const say = (message, urgent = false) => {
    if (status) status.textContent = message;
    announce(message, urgent);
  };

  function currentRound() { return state?.rounds[state.roundIndex] || null; }

  function playClue() {
    const target = currentRound()?.target;
    if (!target) return;
    const { synth, Utterance } = getSpeech();
    if (!synth || !Utterance) {
      textClue.textContent = `Text clue: ${target.spoken}.`;
      textClue.hidden = false;
      say(`Audio speech is unavailable. The text clue is ${target.spoken}.`);
      return;
    }
    try {
      synth.cancel();
      const utterance = new Utterance(target.spoken);
      utterance.lang = 'en-IN';
      utterance.rate = 0.92;
      utterance.pitch = 1.05;
      utterance.onerror = () => {
        if (currentRound()?.target.id === target.id) {
          textClue.textContent = `Text clue: ${target.spoken}.`;
          textClue.hidden = false;
          say(`Speech audio is unavailable. The text clue is ${target.spoken}.`);
        }
      };
      synth.speak(utterance);
      textClue.hidden = true;
    } catch {
      textClue.textContent = `Text clue: ${target.spoken}.`;
      textClue.hidden = false;
      say(`Audio speech is unavailable. The text clue is ${target.spoken}.`);
    }
  }

  function renderRound({ speak = true } = {}) {
    const round = currentRound();
    if (!round) return;
    $('#cm-progress').textContent = `Round ${state.roundIndex + 1} of ${state.roundCount}`;
    $('#cm-score').textContent = `Score: ${state.score} · Streak: ${state.streak}`;
    prompt.textContent = 'Listen for the fruit and quantity, then choose the matching picture.';
    options.replaceChildren(...round.options.map((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-option';
      button.dataset.itemId = item.id;
      button.setAttribute('aria-label', `${item.label}, choice ${index + 1}`);
      button.setAttribute('aria-pressed', 'false');
      const fruit = document.createElement('span');
      fruit.className = 'cm-fruit';
      fruit.setAttribute('aria-hidden', 'true');
      fruit.textContent = item.emoji;
      const label = document.createElement('strong');
      label.className = 'cm-option-label';
      label.textContent = item.label;
      button.append(fruit, label);
      button.addEventListener('click', () => choose(item.id));
      return button;
    }));
    nextButton.hidden = true;
    nextButton.textContent = state.roundIndex + 1 === state.roundCount ? 'View scorecard' : 'Next round';
    revealButton.hidden = false;
    textClue.hidden = true;
    say(`Round ${state.roundIndex + 1} of ${state.roundCount}. Listen to the clue, then select the matching fruit count.`);
    if (speak) playClue();
    options.querySelector('.cm-option')?.focus();
  }

  function choose(itemId) {
    if (!state || state.answeredThisRound || state.done) return;
    const result = answerCountMatch(state, itemId);
    if (result.type === 'ignored') return;
    options.querySelectorAll('.cm-option').forEach(button => {
      button.disabled = true;
      const selected = button.dataset.itemId === result.choice.id;
      const correct = button.dataset.itemId === result.target.id;
      button.setAttribute('aria-pressed', String(selected));
      if (correct) button.classList.add('cm-correct');
      if (selected && button.dataset.itemId !== result.target.id) button.classList.add('cm-wrong');
    });
    if (result.type === 'correct') {
      playSfx('correct');
      if (result.streak >= 3 && result.streak % 3 === 0) playSfx('coin');
      say(`Correct! ${result.target.label}. ${result.points} points. ${result.streak} in a row!`);
    } else {
      playSfx('wrong');
      say(`Not quite. The answer is ${result.target.label}. Keep going!`);
    }
    $('#cm-score').textContent = `Score: ${state.score} · Streak: ${state.streak}`;
    nextButton.hidden = false;
    nextButton.focus();
  }

  function finish() {
    const finishedAt = now();
    const elapsed = Math.max(0, finishedAt - startedAt);
    const accuracy = countMatchAccuracy(state.correct, state.answered);
    const best = readBest();
    const oldBest = Number(best[state.roundCount]) || 0;
    const newBest = state.score > oldBest;
    if (newBest) {
      best[state.roundCount] = state.score;
      saveBest(best);
    }
    finalCard = {
      score: state.score,
      correct: state.correct,
      rounds: state.roundCount,
      accuracy,
      elapsed,
      bestStreak: state.bestStreak,
      newBest,
    };
    $('#cm-final-score').textContent = finalCard.score.toLocaleString();
    $('#cm-final-time').textContent = formatTime(elapsed);
    $('#cm-final-accuracy').textContent = `${accuracy}%`;
    $('#cm-final-correct').textContent = `${state.correct} of ${state.roundCount}`;
    $('#cm-final-streak').textContent = String(state.bestStreak);
    $('#cm-best-note').textContent = newBest ? 'New personal best — brilliant listening!' : `Personal best: ${oldBest.toLocaleString()} points.`;
    gameView.hidden = true;
    scorecard.hidden = false;
    playSfx(state.correct === state.roundCount ? 'cheer' : 'applause');
    say(`Game complete. ${state.score} points, ${formatTime(elapsed)}, ${accuracy} percent accuracy. ${newBest ? 'That is your new personal best!' : ''}`);
    setTimeout(() => $('#cm-share-whatsapp')?.focus(), 60);
  }

  function advance() {
    if (!state) return;
    const result = advanceCountMatch(state);
    if (result.type === 'ignored') return;
    if (result.type === 'done') { finish(); return; }
    renderRound();
  }

  function start(roundCount = Number(roundSelect.value)) {
    // Call resume synchronously inside the Start Game gesture before rendering or speaking.
    let resumePromise;
    try { resumePromise = unlockAudio(); } catch { resumePromise = null; }
    Promise.resolve(resumePromise).catch(() => {});
    const rounds = COUNT_MATCH_ROUNDS.includes(Number(roundCount)) ? Number(roundCount) : 10;
    state = createCountMatchState(rounds, rnd);
    startedAt = now();
    finalCard = null;
    setup.hidden = true;
    scorecard.hidden = true;
    gameView.hidden = false;
    renderRound();
  }

  function open() {
    stop();
    state = null;
    finalCard = null;
    setup.hidden = false;
    gameView.hidden = true;
    scorecard.hidden = true;
    status.textContent = '';
    $('#cm-best-note').textContent = '';
  }

  function stop() {
    const { synth } = getSpeech();
    try { synth?.cancel(); } catch { /* speech may be unavailable */ }
  }

  function payload() {
    if (!finalCard) return null;
    const currentUrl = globalThis.window?.location?.href || globalThis.location?.href || 'https://mahicouragw.github.io/Blind-Quiz/';
    const parts = shareLinks(currentUrl,
      `I scored ${finalCard.score.toLocaleString()} points with ${finalCard.accuracy}% accuracy in ${formatTime(finalCard.elapsed)} on Blind Quiz Count Match.`);
    return { ...parts, ...finalCard };
  }

  async function share(destination) {
    const data = payload();
    if (!data) return;
    if (destination === 'copy') {
      const ok = await copyText(data.text);
      const message = ok ? 'Score and Count Match challenge link copied.' : `Copy this score and challenge link: ${data.text}`;
      $('#cm-share-status').textContent = message;
      announce(message);
      return;
    }
    if (destination === 'instagram') {
      const nav = globalThis.navigator || globalThis.window?.navigator;
      if (typeof nav?.share === 'function') {
        try {
          await nav.share({ title: 'My Count Match score', text: data.text, url: data.url });
          const message = 'Choose Instagram in the share sheet to post your score and challenge link.';
          $('#cm-share-status').textContent = message;
          announce(message);
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      const ok = await copyText(data.text);
      const message = ok
        ? 'Instagram does not support pre-filled web posts. Your score and game link are copied—paste them into a post, Story, or chat.'
        : `Paste this score and game link into Instagram: ${data.text}`;
      $('#cm-share-status').textContent = message;
      announce(message);
      return;
    }
    const url = data[destination];
    if (!url) return;
    openExternal(url);
    const names = { whatsapp: 'WhatsApp', facebook: 'Facebook', x: 'X' };
    const message = `Opening ${names[destination]} to share your score and game link.`;
    $('#cm-share-status').textContent = message;
    announce(message);
  }

  function wire() {
    $('#cm-start')?.addEventListener('click', () => start());
    $('#cm-listen')?.addEventListener('click', playClue);
    revealButton?.addEventListener('click', () => {
      const target = currentRound()?.target;
      if (!target) return;
      textClue.textContent = `Text clue: ${target.spoken}.`;
      textClue.hidden = false;
      say(textClue.textContent);
    });
    nextButton?.addEventListener('click', advance);
    $('#cm-again')?.addEventListener('click', () => start(finalCard?.rounds || Number(roundSelect.value)));
    $('#cm-new-settings')?.addEventListener('click', () => { open(); $('#cm-round-count')?.focus(); });
    document.querySelectorAll('[data-cm-share]').forEach(button => {
      button.addEventListener('click', () => { void share(button.dataset.cmShare); });
    });
  }

  return { wire, open, start, stop, share, get state() { return state; }, get finalCard() { return finalCard; } };
}
