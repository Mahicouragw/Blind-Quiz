import { QUESTION_BANK, CATEGORY_LIST, validateQuestionBank } from './content.js';
import { callApi, getSession, setSession } from './backend.js';
import { shuffled } from './random.js';
import { GAME_MODES, selectRoundQuestions, timeLimitFor, endsAfterMiss } from './game-logic.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  view: 'home',
  category: 'general',
  mode: 'classic',
  questions: [],
  index: 0,
  score: 0,
  answeredCount: 0,
  answered: false,
  lastAnswerCorrect: null,
  timer: null,
  timeLeft: 0,
  roundTimer: 0,
  roundToken: 0,
  locked: false,
  finished: false,
  settings: { largeText: false, highContrast: false, reducedMotion: false, speech: true, timer: 0 },
  profile: null,
};

const modes = GAME_MODES;
const announcementTokens = { polite: 0, assertive: 0 };
const announce = (text, urgent = false) => {
  if (!state.settings.speech) return;
  const channel = urgent ? 'assertive' : 'polite';
  const element = $(urgent ? '#assertive-announcer' : '#announcer');
  const token = ++announcementTokens[channel];
  element.textContent = '';
  setTimeout(() => {
    if (announcementTokens[channel] === token) element.textContent = text;
  }, 30);
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function go(view, { focus } = {}) {
  if (state.view === 'game' && view !== 'game') {
    clearTimer();
    state.roundToken += 1;
    state.locked = false;
    const startButton = $('#game-start');
    if (startButton) startButton.disabled = false;
  }
  $$('.view').forEach(element => { element.hidden = true; });
  $(`#view-${view}`).hidden = false;
  state.view = view;
  window.scrollTo(0, 0);
  if (focus) {
    const element = $(focus);
    setTimeout(() => element?.focus(), 60);
  } else {
    setTimeout(() => {
      const heading = $(`#view-${view} h1`);
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    }, 30);
  }
}

function top() {
  const session = getSession();
  $('#top-meta').textContent = session?.profile?.name ? `${session.profile.name} · Login ID account` : '';
  $('#logout-button').hidden = !session;
}

function renderCategories() {
  const host = $('#category-list');
  host.innerHTML = '';
  for (const category of CATEGORY_LIST) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-button';
    button.dataset.category = category.id;
    button.innerHTML = `<strong>${esc(category.name)}</strong>`;
    host.append(button);
  }
}

function renderModes() {
  const host = $('#mode-list');
  host.innerHTML = '';
  for (const [id, name, description] of modes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode-button';
    button.dataset.mode = id;
    button.innerHTML = `<strong>${esc(name)}</strong><small>${esc(description)}</small>`;
    host.append(button);
  }
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function setAuthTab(tab) {
  $$('[data-auth-tab]').forEach(button => {
    const isActive = button.dataset.authTab === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  $('#login-form').hidden = tab !== 'login';
  $('#signup-form').hidden = tab !== 'signup';
  $('#recovery-form').hidden = true;
  $('#signup-success').hidden = true;
  $('#auth-title').textContent = tab === 'login' ? 'Log in to play' : 'Create your account';
  (tab === 'login' ? $('#login-name') : $('#signup-name')).focus();
}

function showError(selector, message) {
  const element = $(selector);
  element.textContent = message;
  element.hidden = false;
  announce(message, true);
}

const genericLogin = 'The name, Login ID, or secret answer is incorrect. Please try again.';
let questionLookupTimer;
let signupNameTimer;

async function checkSignupName() {
  const name = $('#signup-name').value.trim();
  const status = $('#signup-name-status');
  status.textContent = '';
  if (name.length < 2) return;
  try {
    const data = await callApi('check-name', { name });
    if ($('#signup-name').value.trim() !== name) return;
    status.textContent = data.available
      ? 'Name is available.'
      : 'This name is already registered. Please choose another name.';
    if (!data.available) announce(status.textContent, true);
  } catch {
    if ($('#signup-name').value.trim() === name) {
      status.textContent = 'Name availability will be checked when you create the account.';
    }
  }
}

async function lookupQuestion() {
  const name = $('#login-name').value.trim();
  const loginId = $('#login-id').value.trim().toUpperCase();
  if (name.length < 2 || loginId.length !== 8) return;
  try {
    const data = await callApi('secret-question', { name, loginId });
    if ($('#login-name').value.trim() !== name || $('#login-id').value.trim().toUpperCase() !== loginId) return;
    $('#question-context').textContent = data.question || 'Secret question';
    $('#question-context').hidden = false;
  } catch {
    if ($('#login-name').value.trim() === name && $('#login-id').value.trim().toUpperCase() === loginId) {
      $('#question-context').hidden = true;
    }
  }
}

async function signUp(event) {
  event.preventDefault();
  $('#signup-error').hidden = true;
  const name = $('#signup-name').value.trim();
  const selection = $('#secret-question').value;
  const question = selection === 'custom' ? $('#custom-question').value.trim() : selection;
  const answer = $('#signup-answer').value.trim();
  const button = $('#signup-form button[type=submit]');
  if (name.length < 2 || !question || answer.length < 2) {
    showError('#signup-error', 'Please complete each field with at least two characters.');
    return;
  }
  button.disabled = true;
  button.textContent = 'Creating account…';
  announce('Creating account. Please wait.');
  try {
    const data = await callApi('signup', { name, question, answer });
    $('#signup-success').hidden = false;
    $('#new-login-id').textContent = data.loginId;
    $('#signup-form').hidden = true;
    $('#login-form').hidden = true;
    $('#auth-title').textContent = 'Account created';
    $('#copy-login-id').focus();
    announce(`Your account has been created successfully. Your Login ID is ${data.loginId}.`, true);
  } catch (error) {
    const message = error.message === 'name_taken'
      ? 'This name is already registered. Please choose another name.'
      : error.message === 'rate_limited'
        ? 'Too many attempts. Please wait and try again.'
        : 'Something went wrong. Please try again.';
    showError('#signup-error', message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Create account <span aria-hidden="true">→</span>';
  }
}

async function login(event) {
  event.preventDefault();
  $('#login-error').hidden = true;
  const name = $('#login-name').value.trim();
  const loginId = $('#login-id').value.trim().toUpperCase();
  const answer = $('#login-answer').value.trim();
  const button = $('#login-form button[type=submit]');
  if (!name || loginId.length !== 8 || !answer) {
    showError('#login-error', 'Enter your name, 8-character Login ID, and secret answer.');
    return;
  }
  button.disabled = true;
  announce('Signing in. Please wait.');
  try {
    const data = await callApi('login', { name, loginId, answer });
    setSession({ token: data.token, expiresAt: data.expiresAt, profile: data.profile });
    state.profile = data.profile;
    top();
    if (data.firstLogin) {
      $('#welcome-title').textContent = `Welcome to Blind Quiz, ${data.profile.name}.`;
      $('#welcome-copy').textContent = 'Your quiz journey begins now.';
      go('welcome', { focus: '#welcome-continue' });
      announce(`Login successful. Welcome to Blind Quiz, ${data.profile.name}. Your quiz journey begins now.`);
    } else {
      go('home', { focus: '#play-featured' });
      announce(`Login successful. Welcome, ${data.profile.name}.`);
    }
  } catch (error) {
    showError('#login-error', error.message === 'rate_limited'
      ? 'Too many attempts. Please wait and try again.'
      : genericLogin);
  } finally {
    button.disabled = false;
  }
}

async function recoverLoginId(event) {
  event.preventDefault();
  $('#recovery-error').hidden = true;
  const name = $('#recovery-name').value.trim();
  const selection = $('#recovery-question').value;
  const question = selection === 'custom' ? $('#recovery-custom-question').value.trim() : selection;
  const answer = $('#recovery-answer').value.trim();
  if (!name || !question || !answer) {
    showError('#recovery-error', 'Complete each recovery field.');
    return;
  }
  const button = $('#recovery-form button[type=submit]');
  button.disabled = true;
  try {
    const data = await callApi('recover-id', { name, question, answer });
    $('#recovered-id').textContent = data.loginId;
    $('#recovery-result').hidden = false;
    $('#copy-recovered-id').focus();
    announce(`Your Login ID is ${data.loginId}.`, true);
  } catch (error) {
    showError('#recovery-error', error.message === 'rate_limited'
      ? 'Too many attempts. Please wait and try again.'
      : 'The recovery details are incorrect. Please check them and try again.');
  } finally {
    button.disabled = false;
  }
}

function transformQuestion(question) {
  return {
    ...question,
    displayQuestion: question.question,
    displayAnswers: shuffled(question.answers),
    displayCorrect: question.correctAnswer,
    displayExplain: question.explanation,
  };
}

function startRound(category = 'general', mode = 'classic') {
  if (state.locked) return;
  clearTimer();
  state.roundToken += 1;
  state.category = category;
  state.mode = mode;
  const pool = selectRoundQuestions(QUESTION_BANK, category, mode);
  if (!pool.length) {
    announce('There are not enough questions in this category yet.', true);
    return;
  }
  state.questions = pool.map(transformQuestion);
  state.index = 0;
  state.score = 0;
  state.answeredCount = 0;
  state.answered = false;
  state.lastAnswerCorrect = null;
  state.finished = false;
  state.roundTimer = timeLimitFor(mode, state.settings.timer);
  state.locked = true;

  const modeName = modes.find(item => item[0] === mode)?.[1] || mode;
  const categoryName = CATEGORY_LIST.find(item => item.id === category)?.name || 'Mixed';
  $('#round-label').textContent = `${modeName.toUpperCase()} · ${categoryName.toUpperCase()}`;
  $('#game-start').disabled = false;
  $('#game-start').hidden = false;
  $('#game-start').textContent = 'Play Quiz';
  $('#game-tools').hidden = true;
  $('#round-progress').textContent = `${state.questions.length} questions`;
  $('#progress-meter').style.width = '0%';
  $('#phase-label').textContent = 'READY WHEN YOU ARE';
  $('#game-title').className = '';
  $('#game-title').innerHTML = 'Make some room<br>for a new question.';
  $('#game-copy').hidden = false;
  $('#game-copy').textContent = 'Start when you are ready. The countdown appears on screen and in screen-reader announcements.';
  go('game', { focus: '#game-start' });
  state.locked = false;
}

async function countdownAndBegin() {
  if (state.locked || state.view !== 'game') return;
  state.locked = true;
  const roundToken = state.roundToken;
  const isCurrentRound = () => state.roundToken === roundToken && state.view === 'game';
  const button = $('#game-start');
  button.disabled = true;
  button.textContent = 'Starting…';
  $('#phase-label').textContent = 'GET READY';
  $('#game-title').textContent = 'Get ready!';
  $('#game-copy').hidden = false;
  $('#game-copy').textContent = 'Your round is about to begin.';
  announce('Get ready!');
  await sleep(1050);
  if (!isCurrentRound()) return;
  for (const number of ['3', '2', '1']) {
    $('#game-title').textContent = number;
    $('#game-copy').textContent = '';
    announce(number, true);
    await sleep(1120);
    if (!isCurrentRound()) return;
  }
  $('#game-title').textContent = 'GO!';
  announce('GO!', true);
  await sleep(950);
  if (!isCurrentRound()) return;
  state.locked = false;
  $('#game-tools').hidden = false;
  showQuestion();
}

function updateRoundProgress() {
  const count = state.questions.length;
  const prompt = `Question ${state.index + 1} of ${count}`;
  $('#round-progress').textContent = state.timeLeft > 0
    ? `${prompt} · ${state.timeLeft} seconds remaining`
    : prompt;
}

function showQuestion() {
  clearTimer();
  const question = state.questions[state.index];
  if (!question) {
    finishRound();
    return;
  }
  state.answered = false;
  state.lastAnswerCorrect = null;
  $('#phase-label').textContent = `${question.category.toUpperCase()} · ${question.difficulty.toUpperCase()}`;
  updateRoundProgress();
  $('#progress-meter').style.width = `${state.index / state.questions.length * 100}%`;
  $('#game-title').textContent = `Question ${state.index + 1}. ${question.displayQuestion}`;
  $('#game-title').className = 'question-text';
  $('#game-title').setAttribute('tabindex', '-1');
  $('#game-copy').hidden = true;

  const stage = $('#game-stage');
  stage.querySelector('.answer-list')?.remove();
  stage.querySelector('.feedback')?.remove();
  stage.querySelector('.next-question')?.remove();
  const answerList = document.createElement('div');
  answerList.className = 'answer-list';
  answerList.setAttribute('role', 'group');
  answerList.setAttribute('aria-label', 'Answer choices');
  question.displayAnswers.forEach(answer => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'answer-button';
    button.textContent = answer;
    button.addEventListener('click', () => chooseAnswer(answer, button));
    answerList.append(button);
  });
  stage.append(answerList);
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  stage.append(feedback);
  $('#game-start').hidden = true;
  $('#game-title').focus();
  startTimer();
}

function startTimer() {
  clearTimer();
  const seconds = Number(state.roundTimer ?? state.settings.timer);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  state.timeLeft = seconds;
  updateRoundProgress();
  const warningTimes = [10, 5, 3, 2, 1];
  state.timer = setInterval(() => {
    if (state.view !== 'game' || state.answered) {
      clearTimer();
      return;
    }
    state.timeLeft -= 1;
    updateRoundProgress();
    if (warningTimes.includes(state.timeLeft)) announce(`${state.timeLeft} seconds remaining.`);
    if (state.timeLeft <= 0) {
      clearTimer();
      timeExpired();
    }
  }, 1000);
}

function clearTimer() {
  if (state.timer !== null) clearInterval(state.timer);
  state.timer = null;
  state.timeLeft = 0;
  if (state.view === 'game' && state.questions.length) updateRoundProgress();
}

function offerNextQuestion() {
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'button button-hot next-question';
  const endNow = endsAfterMiss(state.mode, state.lastAnswerCorrect)
    || state.index + 1 >= state.questions.length;
  next.textContent = endNow ? 'View results' : 'Next question';
  next.addEventListener('click', advance, { once: true });
  $('#game-stage').append(next);
}

async function saveAnswerToProfile(question, answer, clientCorrect, session, roundToken) {
  try {
    const saved = await callApi('record-answer', { questionId: question.id, choice: answer });
    const currentSession = getSession();
    const savedCount = Number(saved.profile?.questionsAnswered);
    const currentCount = Number(currentSession?.profile?.questionsAnswered);
    if (saved.profile && currentSession?.token === session.token
      && (!Number.isFinite(currentCount) || !Number.isFinite(savedCount) || savedCount >= currentCount)) {
      state.profile = saved.profile;
      setSession({ ...currentSession, profile: saved.profile });
      top();
    }
    const isCurrentQuestion = state.roundToken === roundToken
      && state.view === 'game'
      && state.questions[state.index]?.id === question.id;
    if (!isCurrentQuestion) return;
    const feedback = $('.feedback', $('#game-stage'));
    if (saved.alreadyAnswered) {
      feedback.textContent += ' This question was already recorded; no additional profile reward was issued.';
      announce('This question was already recorded; no additional profile reward was issued.');
    } else if (typeof saved.correct === 'boolean' && saved.correct !== clientCorrect) {
      feedback.textContent += ' The saved question version differs from this pack, so profile scoring may not match this round.';
      announce('The saved question version differs from this pack, so profile scoring may not match this round.', true);
    }
  } catch {
    const isCurrentQuestion = state.roundToken === roundToken
      && state.view === 'game'
      && state.questions[state.index]?.id === question.id;
    if (!isCurrentQuestion) return;
    const feedback = $('.feedback', $('#game-stage'));
    feedback.textContent += ' We could not save this answer to your profile, but you can continue your round.';
    announce('We could not save this answer to your profile, but you can continue your round.');
  }
}

function chooseAnswer(answer, button) {
  if (state.answered || state.view !== 'game') return;
  state.answered = true;
  state.answeredCount += 1;
  clearTimer();
  const question = state.questions[state.index];
  const correct = answer === question.displayCorrect;
  const roundToken = state.roundToken;
  state.lastAnswerCorrect = correct;
  if (correct) {
    state.score += 1;
    button.classList.add('correct');
  } else {
    button.classList.add('incorrect');
    $$('.answer-button').forEach(choice => {
      if (choice.textContent === question.displayCorrect) choice.classList.add('correct');
    });
  }
  $$('.answer-button').forEach(choice => { choice.disabled = true; });
  const feedback = $('.feedback', $('#game-stage'));
  feedback.textContent = correct
    ? `Correct. ${question.displayExplain}`
    : `Not quite. The answer is ${question.displayCorrect}. ${question.displayExplain}`;
  announce(feedback.textContent, true);
  offerNextQuestion();

  const session = getSession();
  if (session && question.displayAnswers.length === 4) {
    void saveAnswerToProfile(question, answer, correct, session, roundToken);
  }
}

function timeExpired() {
  if (state.answered || state.view !== 'game') return;
  state.answered = true;
  state.answeredCount += 1;
  state.lastAnswerCorrect = false;
  const question = state.questions[state.index];
  $$('.answer-button').forEach(button => {
    button.disabled = true;
    if (button.textContent === question.displayCorrect) button.classList.add('correct');
  });
  $('.feedback', $('#game-stage')).textContent = `Time's up. The answer is ${question.displayCorrect}. ${question.displayExplain}`;
  announce($('.feedback', $('#game-stage')).textContent, true);
  offerNextQuestion();
}

function advance() {
  if (endsAfterMiss(state.mode, state.lastAnswerCorrect)) {
    finishRound();
    return;
  }
  state.index += 1;
  if (state.index >= state.questions.length) {
    finishRound();
    return;
  }
  showQuestion();
}

function finishRound() {
  if (state.finished) return;
  state.finished = true;
  clearTimer();
  $('#progress-meter').style.width = '100%';
  const answered = state.mode === 'survival' ? state.answeredCount : state.questions.length;
  go('results');
  $('#result-score').textContent = `${state.score} correct out of ${answered} answered`;
  $('#result-message').textContent = state.mode === 'survival' && answered < state.questions.length
    ? 'Your Survival run ended on a miss. Start another round and see how long you can last.'
    : state.score === state.questions.length
      ? 'A perfect round. Every answer landed.'
      : state.score >= Math.ceil(state.questions.length * 0.7)
        ? 'Strong round. Keep that rhythm.'
        : 'Every question is another clue for next time.';
  announce(`Round complete. ${state.score} correct out of ${answered} answered.`, true);
}

function repeatQuestion() {
  const question = state.questions[state.index];
  if (question) announce(`Question ${state.index + 1}. ${question.displayQuestion}`, true);
}

function loadSettings() {
  let saved = {};
  try {
    const parsed = JSON.parse(localStorage.getItem('bq.settings') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
  } catch {
    saved = {};
  }
  state.settings = {
    largeText: saved.largeText === true,
    highContrast: saved.highContrast === true,
    reducedMotion: saved.reducedMotion === true,
    speech: saved.speech !== false,
    timer: [0, 15, 30].includes(Number(saved.timer)) ? Number(saved.timer) : 0,
  };
  $('#large-text').checked = state.settings.largeText;
  $('#high-contrast').checked = state.settings.highContrast;
  $('#reduced-motion').checked = state.settings.reducedMotion;
  $('#speech-on').checked = state.settings.speech;
  $('#timer-choice').value = String(state.settings.timer);
  document.body.classList.toggle('large-text', state.settings.largeText);
  document.body.classList.toggle('high-contrast', state.settings.highContrast);
  document.body.classList.toggle('reduce-motion', state.settings.reducedMotion);
}

function saveSettings() {
  state.settings = {
    largeText: $('#large-text').checked,
    highContrast: $('#high-contrast').checked,
    reducedMotion: $('#reduced-motion').checked,
    speech: $('#speech-on').checked,
    timer: [0, 15, 30].includes(Number($('#timer-choice').value)) ? Number($('#timer-choice').value) : 0,
  };
  let saved = true;
  try {
    localStorage.setItem('bq.settings', JSON.stringify(state.settings));
  } catch {
    saved = false;
  }
  loadSettings();
  announce(saved ? 'Settings saved.' : 'Settings applied for this session; saving is unavailable.');
  go('home', { focus: '#settings-open' });
}

function wire() {
  $('.brand').addEventListener('click', event => {
    event.preventDefault();
    go('home', { focus: '#play-featured' });
  });
  $('#play-featured').addEventListener('click', () => startRound('general', 'classic'));
  $('#category-list').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (button) startRound(button.dataset.category, 'classic');
  });
  $('#mode-list').addEventListener('click', event => {
    const button = event.target.closest('[data-mode]');
    if (button) startRound('general', button.dataset.mode);
  });
  $('#random-category').addEventListener('click', () => {
    const options = CATEGORY_LIST.filter(category => category.count >= 4);
    const category = options[Math.floor(Math.random() * options.length)];
    if (category) startRound(category.id, 'classic');
  });
  $('.callout [data-category="braille"]').addEventListener('click', () => startRound('braille', 'classic'));

  $('#account-open').addEventListener('click', () => {
    setAuthTab('login');
    go('auth', { focus: '#login-name' });
  });
  $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
  $('#login-form').addEventListener('submit', login);
  $('#signup-form').addEventListener('submit', signUp);
  $('#recovery-form').addEventListener('submit', recoverLoginId);
  $('#recover-open').addEventListener('click', () => {
    $('#login-form').hidden = true;
    $('#signup-form').hidden = true;
    $('#recovery-form').hidden = false;
    $('#recovery-result').hidden = true;
    $('#auth-title').textContent = 'Recover your Login ID';
    $('#recovery-name').focus();
  });
  $('#recovery-back').addEventListener('click', () => {
    setAuthTab('login');
    $('#recovery-form').hidden = true;
    $('#login-form').hidden = false;
  });
  $('#recovery-question').addEventListener('change', () => {
    $('#recovery-custom-wrap').hidden = $('#recovery-question').value !== 'custom';
    if (!$('#recovery-custom-wrap').hidden) $('#recovery-custom-question').focus();
  });
  $('#copy-recovered-id').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#recovered-id').textContent);
      announce('Login ID copied.');
    } catch {
      announce('Copy is unavailable. Select the Login ID text to copy it.');
    }
  });
  $('#signup-name').addEventListener('input', () => {
    clearTimeout(signupNameTimer);
    signupNameTimer = setTimeout(checkSignupName, 450);
  });
  $('#secret-question').addEventListener('change', () => {
    $('#custom-question-wrap').hidden = $('#secret-question').value !== 'custom';
    if (!$('#custom-question-wrap').hidden) $('#custom-question').focus();
  });
  ['#login-name', '#login-id'].forEach(selector => $(selector).addEventListener('input', () => {
    $('#question-context').hidden = true;
    clearTimeout(questionLookupTimer);
    questionLookupTimer = setTimeout(lookupQuestion, 500);
  }));
  $('#copy-login-id').addEventListener('click', async () => {
    const id = $('#new-login-id').textContent;
    try {
      await navigator.clipboard.writeText(id);
      announce('Login ID copied.');
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('#new-login-id'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      announce('Select and copy your Login ID.');
    }
  });
  $('#continue-login').addEventListener('click', () => {
    setAuthTab('login');
    $('#login-name').value = $('#signup-name').value;
    $('#login-id').value = $('#new-login-id').textContent;
    go('auth', { focus: '#login-answer' });
  });

  $('#game-start').addEventListener('click', countdownAndBegin);
  $('#repeat-question').addEventListener('click', repeatQuestion);
  $('#read-status').addEventListener('click', () => {
    announce(`Question ${state.index + 1} of ${state.questions.length}. Score ${state.score}.`);
  });
  $('#play-again').addEventListener('click', () => startRound(state.category, state.mode));
  $('#settings-open').addEventListener('click', () => go('settings'));
  $('#save-settings').addEventListener('click', saveSettings);
  $('#welcome-continue').addEventListener('click', () => go('home', { focus: '#play-featured' }));
  $('#profile-auth').addEventListener('click', () => {
    setAuthTab('login');
    go('auth');
  });
  $('#logout-button').addEventListener('click', () => {
    // Revoke the server session in the background, but never make local logout wait on the network.
    void callApi('logout').catch(() => {});
    setSession(null);
    state.profile = null;
    top();
    announce('You are logged out.');
    go('home', { focus: '#account-open' });
  });
  $$('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)));
}

function init() {
  renderCategories();
  renderModes();
  $('#question-count').textContent = QUESTION_BANK.length;
  const errors = validateQuestionBank();
  if (errors.length) {
    console.error('Question validation errors', errors);
    announce('Some question data needs review.');
  }
  loadSettings();
  wire();
  top();
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch {
    // The app remains usable when service workers are unsupported or blocked.
  }
  announce('Blind Quiz ready. Choose a category or start a round.');
}

init();
