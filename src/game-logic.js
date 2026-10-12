import { shuffled } from './random.js';
import { questionMatchesDifficulty } from './quiz-levels.js';

export const GAME_MODES = [
  ['classic', 'Classic Quiz', 'A balanced mix from different categories.'],
  ['rapid', 'Rapid Fire', 'A short, fast round with a 15-second clock.'],
  ['timeattack', 'Time Attack', 'A focused round with a 10-second clock.'],
  ['survival', 'Survival', 'Keep your run alive; one miss ends it. Choose how long it can be.'],
  ['random', 'Random Mix', 'Questions drawn from the full playable pack.'],
  ['vocabulary', 'Vocabulary', 'Meanings, context, and spelling.'],
  ['abbreviations', 'Abbreviations', 'Decode common short forms.'],
  ['braille', 'Braille', 'Explore letters through six-dot patterns.'],
  ['yesno', 'Yes or No', 'Decide whether a suggested answer is correct.'],
  ['decision', 'Decision', 'Choose the right answer from two options.'],
  ['quickdecision', 'Quick Decision', 'Choose from two options before the five-second clock runs out.'],
];

/** Present the same source question in each mode; a supplied shuffle can keep multiplayer clients in sync. */
function sourceAnswer(question, displayedAnswer) {
  return question?.sourceAnswerByDisplay?.[displayedAnswer] ?? displayedAnswer;
}

export function presentQuestion(question, mode = 'classic', shuffle = shuffled, candidateOverride = null) {
  const answers = Array.isArray(question?.answers) ? question.answers : [];
  if (mode === 'yesno') {
    const candidate = candidateOverride ?? shuffle(answers)[0] ?? question.correctAnswer;
    const isCorrectCandidate = candidate === question.correctAnswer;
    const yes = question.language === 'te' ? 'అవును' : 'Yes';
    const no = question.language === 'te' ? 'కాదు' : 'No';
    const wrongDisplay = answers.find(answer => answer !== question.correctAnswer);
    const displayQuestion = question.language === 'te'
      ? `${question.question} “${candidate}” సరైన సమాధానమా?`
      : `${question.question} Is “${candidate}” the correct answer?`;
    return {
      ...question,
      displayQuestion,
      displayAnswers: [yes, no],
      displayCorrect: isCorrectCandidate ? yes : no,
      recordChoiceByDisplay: {
        [yes]: isCorrectCandidate ? sourceAnswer(question, question.correctAnswer) : sourceAnswer(question, candidate),
        [no]: isCorrectCandidate ? sourceAnswer(question, wrongDisplay) : sourceAnswer(question, question.correctAnswer),
      },
      displayExplain: question.explanation,
    };
  }
  if (mode === 'decision' || mode === 'quickdecision') {
    const wrong = shuffle(answers.filter(answer => answer !== question.correctAnswer))[0];
    const displayAnswers = shuffle([question.correctAnswer, wrong].filter(Boolean));
    return {
      ...question,
      displayQuestion: question.question,
      displayAnswers,
      displayCorrect: question.correctAnswer,
      recordChoiceByDisplay: Object.fromEntries(displayAnswers.map(answer => [answer, sourceAnswer(question, answer)])),
      displayExplain: question.explanation,
    };
  }
  const displayAnswers = shuffle(answers);
  return {
    ...question,
    displayQuestion: question.question,
    displayAnswers,
    displayCorrect: question.correctAnswer,
    recordChoiceByDisplay: Object.fromEntries(displayAnswers.map(answer => [answer, sourceAnswer(question, answer)])),
    displayExplain: question.explanation,
  };
}


export function poolFor(questionBank, category, mode) {
  let pool = questionBank.filter(question => category === 'general' || question.category === category);
  if (mode === 'vocabulary') pool = pool.filter(question => question.category === 'vocabulary');
  if (mode === 'abbreviations') pool = pool.filter(question => question.category === 'abbreviations');
  if (mode === 'braille') pool = pool.filter(question => question.category === 'braille');
  return pool;
}

function questionLimit(mode, poolSize, requestedLength = null) {
  const requested = Number(requestedLength);
  if ([5, 10, 15].includes(requested)) return Math.min(requested, poolSize);
  if (mode === 'rapid') return Math.min(8, poolSize);
  if (mode === 'timeattack' || mode === 'quickdecision') return Math.min(10, poolSize);
  if (mode === 'survival') return Math.min(20, poolSize);
  return Math.min(10, poolSize);
}

export function selectRoundQuestions(questionBank, category = 'general', mode = 'classic', shuffle = shuffled, options = {}) {
  const settings = typeof options === 'string' ? { difficulty: options } : (options || {});
  let pool = poolFor(questionBank, category, mode);
  if (settings.difficulty && settings.difficulty !== 'all') {
    pool = pool.filter(question => questionMatchesDifficulty(question, settings.difficulty));
  }
  if (!pool.length) return [];

  const limit = questionLimit(mode, pool.length, settings.roundLength);
  if (mode === 'classic' && category === 'general') {
    const categories = shuffle([...new Set(pool.map(question => question.category))]);
    if (settings.roundLength) {
      const queues = new Map(categories.map(id => [id, shuffle(pool.filter(question => question.category === id))]));
      const selected = [];
      while (selected.length < limit) {
        let added = false;
        for (const id of categories) {
          const question = queues.get(id)?.shift();
          if (question) { selected.push(question); added = true; }
          if (selected.length >= limit) break;
        }
        if (!added) break;
      }
      return shuffle(selected);
    }
    const selected = categories.slice(0, limit).map(id => {
      const categoryPool = pool.filter(question => question.category === id);
      return shuffle(categoryPool)[0];
    });
    return shuffle(selected);
  }
  return shuffle(pool).slice(0, limit);
}

export function timeLimitFor(mode, configuredSeconds = 0) {
  if (mode === 'rapid') return 15;
  if (mode === 'timeattack') return 10;
  if (mode === 'quickdecision') return 5;
  const seconds = Number(configuredSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function endsAfterMiss(mode, correct) {
  return mode === 'survival' && !correct;
}
