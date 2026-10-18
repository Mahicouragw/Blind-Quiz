import { callApi } from './backend.js';
import { QUESTION_BANK } from './content.js';

const $ = selector => document.querySelector(selector);
const GAME_NAMES = { quiz: 'Quiz', letters: 'Letters to Words', soundmatch: 'Sound Match', snakes: 'Snakes and Ladders', ludo: 'Ludo', carrom: 'Carrom', blackjack: 'Blackjack', chess: 'Chess' };
const PIECES = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = String(text); return el; };
const time = value => { const stamp = Date.parse(value); return Number.isFinite(stamp) ? new Date(stamp).toLocaleString() : 'Time unavailable'; };
const status = $('#replay-status');
let replay = null, current = 0, timer = null;

function setStatus(text, urgent = false) { status.textContent = text; status.setAttribute('aria-live', urgent ? 'assertive' : 'polite'); }
function playerForSeat(seat) { return replay?.game?.players?.find(player => Number(player.seat) === Number(seat)); }
function playerLabel(seat) { const player = playerForSeat(seat); return player?.name ? `Player ${seat}: ${player.name}` : `Player ${seat}`; }
function announceStep(step, index, total) {
  const range = $('#replay-range');
  range.value = String(index); range.max = String(Math.max(0, total - 1));
  $('#replay-previous').disabled = index <= 0;
  $('#replay-next').disabled = index >= total - 1;
  $('#replay-step-status').textContent = `Step ${index + 1} of ${total} · ${step.phase} · ${time(step.createdAt)}`;
}

function appendQuiz(step, host) {
  const state = step.state || {}, ids = Array.isArray(state.questionIds) ? state.questionIds : [];
  const index = Number(state.currentIndex) || 0;
  const progress = node('p', 'replay-highlight', index >= ids.length ? `Quiz complete · ${ids.length} questions` : `Question ${index + 1} of ${ids.length}`);
  host.append(progress);
  if (index < ids.length) {
    const question = QUESTION_BANK.find(item => item.id === ids[index]);
    if (question) {
      const card = node('article', 'replay-question');
      card.append(node('h4', '', question.question));
      const options = node('ol', 'replay-options');
      for (const answer of Array.isArray(question.answers) ? question.answers : []) options.append(node('li', '', answer));
      card.append(options);
      host.append(card);
    } else host.append(node('p', 'muted', 'This question is not present in the current question pack.'));
  } else if (ids.length) host.append(node('p', 'muted', 'The final question has been completed.'));

  const attempts = Array.isArray(step.attemptsByQuestion) ? step.attemptsByQuestion : [];
  const correct = new Map(), wrong = new Map();
  for (const item of attempts) {
    const responses = item?.responses && typeof item.responses === 'object' ? item.responses : {};
    for (const [seat, result] of Object.entries(responses)) {
      const counts = result === true ? correct : wrong;
      counts.set(Number(seat), (counts.get(Number(seat)) || 0) + 1);
    }
  }
  if (correct.size || wrong.size) {
    const results = node('section', 'replay-attempts'); results.append(node('h4', '', 'Answer results (correctness only)'));
    const list = node('ul', 'replay-attempt-list');
    const seats = [...new Set([...correct.keys(), ...wrong.keys()])].sort((a, b) => a - b);
    for (const seat of seats) list.append(node('li', '', `${playerLabel(seat)} · ${correct.get(seat) || 0} correct, ${wrong.get(seat) || 0} incorrect`));
    results.append(list); host.append(results);
  }
}

function appendLetters(step, host) {
  const state = step.state || {}, letters = [...String(state.letters || '').toUpperCase()];
  if (letters.length) host.append(node('p', 'replay-highlight', `Letters: ${letters.join(' · ')}`));
  const words = Array.isArray(state.foundWords) ? state.foundWords : [];
  const list = node('ol', 'replay-word-list');
  for (const item of words) list.append(node('li', '', `${String(item.word || '').toUpperCase()} · ${playerLabel(item.seat)} · ${Number(item.points) || 0} points`));
  if (words.length) host.append(node('h4', '', 'Words found'), list);
  else host.append(node('p', 'muted', 'No words had been recorded at this step.'));
  if (state.winner != null) host.append(node('p', 'replay-highlight', state.winner === 0 ? 'The round ended in a tie.' : `${playerLabel(state.winner)} won the round.`));
}

function appendSoundMatch(step, host) {
  const state = step.state || {}, count = Math.max(0, Math.min(40, Number(state.cardCount) || 0));
  const matched = new Set(Array.isArray(state.matched) ? state.matched.map(Number) : []);
  const names = state.revealedNames && typeof state.revealedNames === 'object' ? state.revealedNames : {};
  const visible = new Set(Array.isArray(state.visiblePair) ? state.visiblePair.map(Number) : []);
  host.append(node('p', 'replay-highlight', `Turn: ${state.turnSeat ? playerLabel(state.turnSeat) : 'complete'} · ${matched.size} matched cards`));
  const grid = node('ol', 'replay-sound-grid');
  for (let i = 1; i <= count; i++) {
    const revealed = matched.has(i) || visible.has(i);
    const name = names[String(i)];
    grid.append(node('li', `replay-sound-card${matched.has(i) ? ' is-matched' : ''}`, revealed ? `${name || 'Revealed sound'} · card ${i}` : `Hidden card ${i}`));
  }
  if (count) host.append(grid);
}

function appendChess(step, host) {
  const state = step.state || {}, board = Array.isArray(state.board) ? state.board : [];
  const grid = node('div', 'replay-chess-board'); grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', 'Chess position in this replay step');
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = String(board[r]?.[c] || ''), square = node('div', `replay-chess-square${(r + c) % 2 ? ' dark-square' : ' light-square'}`, PIECES[piece] || '·');
    square.setAttribute('role', 'gridcell');
    square.setAttribute('aria-label', `${String.fromCharCode(97 + c)}${8 - r}: ${piece ? (piece === piece.toUpperCase() ? 'White' : 'Black') + ' ' + ({ k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[piece.toLowerCase()] || 'piece') : 'empty'}`);
    grid.append(square);
  }
  host.append(grid, node('p', 'muted', state.finished ? (state.winner === 0 ? 'Draw.' : `${playerLabel(state.winner)} won.`) : `${playerLabel(state.turnSeat)} to move.`));
}

function appendBlackjack(step, host) {
  const state = step.state || {};
  const handText = cards => Array.isArray(cards) && cards.length ? cards.join(' · ') : 'No cards';
  const dealer = node('article', 'replay-hand'); dealer.append(node('h4', '', 'Dealer'), node('p', '', handText(state.dealer))); host.append(dealer);
  for (const player of Array.isArray(state.players) ? state.players : []) {
    const hand = node('article', 'replay-hand');
    hand.append(node('h4', '', playerLabel(player.seat)), node('p', '', `${handText(player.hand)}${player.bust ? ' · Bust' : ''}${player.stood ? ' · Stood' : ''}`)); host.append(hand);
  }
}

function appendCarrom(step, host) {
  const state = step.state || {}, svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Carrom board position at this replay step');
  const board = document.createElementNS(svg.namespaceURI, 'rect'); board.setAttribute('x', '4'); board.setAttribute('y', '4'); board.setAttribute('width', '92'); board.setAttribute('height', '92'); board.setAttribute('rx', '7'); board.setAttribute('class', 'carrom-wood'); svg.append(board);
  for (const [x, y] of [[8, 8], [92, 8], [8, 92], [92, 92]]) { const pocket = document.createElementNS(svg.namespaceURI, 'circle'); pocket.setAttribute('cx', String(x)); pocket.setAttribute('cy', String(y)); pocket.setAttribute('r', '5'); pocket.setAttribute('class', 'carrom-pocket'); svg.append(pocket); }
  for (const coin of Array.isArray(state.coins) ? state.coins : []) if (!coin.pocketed) { const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', String(Number(coin.x) * 100)); circle.setAttribute('cy', String(Number(coin.y) * 100)); circle.setAttribute('r', '2.2'); circle.setAttribute('class', `carrom-coin seat-${Number(coin.owner) || 1}`); svg.append(circle); }
  const striker = state.striker || { x: .5, y: .88 }, marker = document.createElementNS(svg.namespaceURI, 'circle'); marker.setAttribute('cx', String(Number(striker.x) * 100)); marker.setAttribute('cy', String(Number(striker.y) * 100)); marker.setAttribute('r', '3.2'); marker.setAttribute('class', 'carrom-striker'); svg.append(marker);
  host.append(svg, node('p', 'muted', `${playerLabel(state.turnSeat)} to play · ${Array.isArray(state.coins) ? state.coins.filter(c => c.pocketed).length : 0} coins pocketed`));
}

function appendBoardSummary(step, host) {
  const state = step.state || {}, players = Array.isArray(state.players) ? state.players : [];
  if (replay.game.kind === 'chess') return appendChess(step, host);
  if (replay.game.kind === 'blackjack') return appendBlackjack(step, host);
  if (replay.game.kind === 'carrom') return appendCarrom(step, host);
  if (players.length) {
    const list = node('ul', 'replay-board-players');
    for (const player of players) {
      let detail = '';
      if (replay.game.kind === 'snakes') detail = `Square ${Number(player.position) + 1}`;
      else if (replay.game.kind === 'ludo') detail = `Tokens: ${(Array.isArray(player.tokens) ? player.tokens : []).map(x => Number(x) < 0 ? 'Home' : Number(x) === 57 ? 'Finish' : `square ${Number(x) + 1}`).join(', ')}`;
      else detail = `Score ${Number(player.score) || 0}`;
      list.append(node('li', '', `${playerLabel(player.seat)} · ${detail}`));
    }
    host.append(list);
  }
  if (state.lastRoll) host.append(node('p', 'replay-highlight', `Player ${state.lastRoll.seat} rolled ${state.lastRoll.roll}: ${state.lastRoll.from + 1} → ${state.lastRoll.to + 1}${state.lastRoll.special ? `, ${state.lastRoll.special}` : ''}`));
  if (state.winner != null) host.append(node('p', 'replay-highlight', state.winner === 0 ? 'The match was a draw.' : `${playerLabel(state.winner)} won.`));
}

function renderStep(index) {
  if (!replay?.steps?.length) return;
  current = Math.max(0, Math.min(replay.steps.length - 1, index));
  const step = replay.steps[current], host = $('#replay-step-view'); host.replaceChildren();
  announceStep(step, current, replay.steps.length);
  if (replay.game.kind === 'quiz') appendQuiz(step, host);
  else if (replay.game.kind === 'letters') appendLetters(step, host);
  else if (replay.game.kind === 'soundmatch') appendSoundMatch(step, host);
  else appendBoardSummary(step, host);
  const details = node('details', 'replay-json-details'), summary = node('summary', '', 'Inspect sanitized snapshot data');
  const pre = node('pre', 'replay-json', JSON.stringify({ phase: step.phase, state: step.state, attemptsByQuestion: step.attemptsByQuestion }, null, 2));
  details.append(summary, pre); host.append(details);
}

function pause() { if (timer !== null) clearInterval(timer); timer = null; $('#replay-play').textContent = 'Play replay'; $('#replay-play').setAttribute('aria-pressed', 'false'); }
function play() {
  if (timer !== null) { pause(); return; }
  if (current >= replay.steps.length - 1) renderStep(0);
  $('#replay-play').textContent = 'Pause replay'; $('#replay-play').setAttribute('aria-pressed', 'true');
  timer = setInterval(() => { if (current >= replay.steps.length - 1) { pause(); return; } renderStep(current + 1); }, 1400);
}

async function downloadData() {
  const button = $('#replay-download'), target = $('#replay-download-status'); button.disabled = true; target.textContent = 'Preparing the sanitized replay data…';
  try {
    const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    const safe = String(replay.game.title || 'room-match').normalize('NFKC').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'room-match';
    anchor.href = url; anchor.download = `${safe}-replay.json`; anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    target.textContent = 'Sanitized replay data downloaded.';
  } catch { target.textContent = 'The replay data could not be downloaded on this device.'; }
  finally { button.disabled = false; }
}

async function load() {
  const shareId = new URLSearchParams(location.search).get('id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shareId || '')) { setStatus('This replay link is incomplete or invalid.', true); return; }
  try {
    replay = await callApi('replay-read', { shareId });
    if (!replay.game || !Array.isArray(replay.steps) || !replay.steps.length) throw new Error('replay_unavailable');
    const game = replay.game;
    $('#replay-game-title').textContent = game.title || GAME_NAMES[game.kind] || 'Room match';
    const label = GAME_NAMES[game.kind] || 'Room match', players = Array.isArray(game.players) ? game.players : [];
    $('#replay-game-summary').textContent = `${label} · Finished ${time(game.finishedAt)} · ${replay.steps.length} saved step${replay.steps.length === 1 ? '' : 's'} · Link expires ${time(replay.expiresAt)}`;
    const scores = $('#replay-scores');
    scores.replaceChildren(...players.map(player => node('li', 'replay-score', `${playerLabel(player.seat)} · ${Number(player.score) || 0} points${player.color ? ` · ${player.color}` : ''}`)));
    if (!players.length) scores.append(node('li', 'muted', 'No final player scores were saved.'));
    $('#replay-range').max = String(replay.steps.length - 1);
    $('#replay-content').hidden = false; setStatus('Replay loaded. Use Previous, Next, Play replay, or the position slider to explore each saved move.');
    renderStep(0);
  } catch (error) {
    const message = error?.message === 'replay_unavailable' ? 'This replay link has expired, was removed, or does not exist.'
      : error?.message === 'rate_limited' ? 'Too many replay requests. Please wait and try again.'
        : error?.message === 'network' || error?.message === 'timeout' ? 'The replay could not be loaded. Check your connection and try again.'
          : 'The replay could not be loaded. Please try again later.';
    setStatus(message, true);
  }
}

$('#replay-previous').addEventListener('click', () => { pause(); renderStep(current - 1); });
$('#replay-next').addEventListener('click', () => { pause(); renderStep(current + 1); });
$('#replay-play').addEventListener('click', play);
$('#replay-range').addEventListener('input', event => { pause(); renderStep(Number(event.currentTarget.value)); });
$('#replay-download').addEventListener('click', downloadData);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
load();
