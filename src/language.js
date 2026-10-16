// English is the default. Telugu is an intentional starter pack: core quiz controls and
// spoken instructions are translated, with a focused set of translated questions.
export const LANGUAGE_LABELS = { en: 'English', te: 'తెలుగు' };

const UI = {
  en: {
    homeEyebrow: 'PLAY BY EAR · PLAY BY EYE',
    homeTitle: 'Hear it. Tap it. Win it.',
    homeLead: 'Listen to a question or read it. Choose an answer by touch, mouse, keyboard, or screen reader.',
    playNow: 'Play now', account: 'Sign in or create account', profile: name => `Your profile: ${name}`,
    settings: 'Settings', settingsAria: 'Open settings: accessibility, sound, and music',
    categories: 'Explore by category', chooseWorld: 'CHOOSE YOUR WORLD', random: 'Surprise me', categoryUnit: 'categories',
    modes: 'Game modes', chooseChallenge: 'PICK A CHALLENGE', gameStatus: 'Game status', difficultyCount: 'difficulty levels', audioFirst: 'Audio-first', playWord: 'play', inputMethods: 'Tap, click, keys A–D, or screen reader',
    setupEyebrow: 'MAKE IT YOURS', setupTitle: 'Choose your quiz',
    language: 'Game language', stage: 'Progression stage', stageWord: 'Stage', locked: 'locked', difficulty: 'Difficulty',
    roundLength: 'Questions per round', custom: 'Custom challenge', mixed: 'Mixed',
    easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert',
    fiveQuestions: '5 questions', tenQuestions: '10 questions', fifteenQuestions: '15 questions',
    voiceButton: 'Hear how to play', voiceUnavailable: 'Spoken instructions are not available on this device. You can still use the screen reader instructions.', teluguVoiceMissing: 'No Telugu voice is installed on this device. Install a Telugu text-to-speech voice, or use a screen reader to hear Telugu text.',
    voiceStarted: 'Playing the instructions aloud.',
    stageLocked: 'Locked. Complete the previous stage with at least 70 percent correct to unlock this one.',
    stageReady: (n, title, difficulty, count) => `Stage ${n}: ${title}. ${difficulty}, up to ${count} questions. Get at least 70 percent correct to unlock the next stage.`,
    stageCustom: 'Custom challenge. Choose a difficulty and round length.',
    stagePassed: (n, next) => `Great job! Stage ${n} is complete. Stage ${next} is unlocked.`,
    stageFailed: n => `Stage ${n} is not unlocked yet. Try again and aim for at least 70 percent correct.`,
    stageMastered: 'Amazing! You completed the final quiz stage.',
    stageProgress: (n, max) => `Stage ${n} of ${max} is unlocked.`,
    teluguNote: count => `Telugu starter pack: ${count} questions across selected topics. More Telugu topics will be added in future updates.`,
    question: (current, total) => `Question ${current} of ${total}`,
    answerChoices: 'Answer choices', options: 'Options', option: (letter, answer) => `Option ${letter}: ${answer}. Double tap to select.`, optionResult: (letter, answer) => `Option ${letter}: ${answer}`, correctLabel: 'correct answer', incorrectLabel: 'incorrect', yourAnswer: 'your answer',
    correct: 'Correct!', incorrectTitle: 'Incorrect.', incorrect: answer => `Incorrect. The correct answer is ${answer}.`,
    correctAnswer: answer => `The answer is ${answer}.`, yourChoice: (choice, answer) => `You chose ${choice}. The correct answer is ${answer}.`,
    streak: n => `Streak: ${n} in a row.`, streakReset: 'Streak reset.', earnLogin: 'Sign in to earn XP and coins.',
    xpCoins: (xp, coins) => `You earned ${xp} XP and ${coins} coins.`, alreadyRewarded: 'You already earned the reward for this question in an earlier round.',
    sessionEnded: 'Your session has ended. Sign in again to keep saving your progress.', saveOffline: 'We could not save this answer to your profile, but you can continue your round.',
    getReady: 'Get ready!', getReadyCopy: 'Your round is about to begin.', starting: 'Starting…',
    go: 'GO!', timer: seconds => `${seconds} ${seconds===1?'second':'seconds'} remaining.`,
    repeat: 'Hear question and options again', roundStatus: 'Round status',
    playQuiz: 'Play Quiz', answerAgain: 'Next question', viewResults: 'View results',
    autoAdvance: (seconds, action, finalStep) => finalStep ? `Results appear in ${seconds} seconds. Choose ${action} to view them now.` : `Next question starts in ${seconds} seconds. Choose ${action} to continue now.`,
    resultScore: (score, total) => `${score} correct out of ${total}`,
    roundComplete: (score, total) => `Round complete. ${score} correct out of ${total}.`,
    resultPerfect: 'A perfect round. Every answer landed.',
    resultStrong: 'Strong round. Keep that rhythm.',
    resultTryAgain: 'Every question is another clue for next time.',
    survivalEnded: 'Your Survival run ended on a miss. Start another round and see how long you can last.',
    welcome: 'Welcome to Accessible Quiz Game, created by K M Sanjay. Screen reader announcements are ON. Swipe right or press Next to navigate.',
    ready: 'Blind Quiz ready. Choose a category or start a round.', settingsSaved: 'Settings saved.',
    moreTelugu: 'Telugu starter questions cover selected topics. Spoken Telugu instructions need a Telugu text-to-speech voice installed on your device; English has the full question library.', notAvailable: 'More Telugu content is coming soon.',
    noQuestions: 'There are not enough questions in this category for that choice yet.',
    starterCategories: 'TELUGU STARTER TOPICS',
    signInStatus: 'Signed in as',
  },
  te: {
    homeEyebrow: 'విని ఆడండి · చదివి ఆడండి',
    homeTitle: 'వినండి. తాకండి. గెలవండి.',
    homeLead: 'ప్రశ్నను వినండి లేదా చదవండి. స్పర్శ, మౌస్, కీబోర్డ్ లేదా స్క్రీన్ రీడర్‌తో సమాధానాన్ని ఎంచుకోండి.',
    playNow: 'ఇప్పుడే ఆడండి', account: 'సైన్ ఇన్ చేయండి లేదా ఖాతా సృష్టించండి', profile: name => `మీ ప్రొఫైల్: ${name}`,
    settings: 'సెట్టింగ్‌లు', settingsAria: 'అందుబాటు సౌకర్యాలు, శబ్దం, సంగీతం కోసం సెట్టింగ్‌లు తెరవండి',
    categories: 'వర్గం ద్వారా ఎంచుకోండి', chooseWorld: 'మీ ప్రశ్నల ప్రపంచాన్ని ఎంచుకోండి', random: 'ఒకదాన్ని ఎంచుకోండి', categoryUnit: 'అంశాలు',
    modes: 'ఆట రకాలు', chooseChallenge: 'ఒక సవాలును ఎంచుకోండి', gameStatus: 'ఆట స్థితి', difficultyCount: 'కష్ట స్థాయిలు', audioFirst: 'శబ్దం ముందుగా', playWord: 'ఆట', inputMethods: 'తాకండి, క్లిక్ చేయండి, A–D నొక్కండి లేదా స్క్రీన్ రీడర్ వాడండి',
    setupEyebrow: 'మీకు నచ్చినట్టు అమర్చుకోండి', setupTitle: 'మీ క్విజ్‌ను ఎంచుకోండి',
    language: 'ఆట భాష', stage: 'ప్రగతి దశ', stageWord: 'దశ', locked: 'లాక్ అయింది', difficulty: 'కష్టం',
    roundLength: 'ఒక్కో రౌండ్‌లో ప్రశ్నలు', custom: 'మీ సవాలు', mixed: 'మిశ్రమం',
    easy: 'సులభం', medium: 'మధ్యస్థం', hard: 'కష్టం', expert: 'నిపుణుల స్థాయి',
    fiveQuestions: '5 ప్రశ్నలు', tenQuestions: '10 ప్రశ్నలు', fifteenQuestions: '15 ప్రశ్నలు',
    voiceButton: 'ఆట ఎలా ఆడాలో వినండి', voiceUnavailable: 'ఈ పరికరంలో మాటల సూచనలు అందుబాటులో లేవు. స్క్రీన్ రీడర్ సూచనలను ఉపయోగించవచ్చు.', teluguVoiceMissing: 'ఈ పరికరంలో తెలుగు మాటల స్వరం ఇన్‌స్టాల్ కాలేదు. తెలుగు టెక్స్ట్-టు-స్పీచ్ స్వరాన్ని ఇన్‌స్టాల్ చేయండి లేదా స్క్రీన్ రీడర్ ఉపయోగించండి.',
    voiceStarted: 'ఆట సూచనలు వినిపిస్తున్నాయి.',
    stageLocked: 'ఇది ఇంకా తెరుచుకోలేదు. తర్వాతి దశను తెరవడానికి ముందు దశలో కనీసం 70 శాతం సరైన సమాధానాలు ఇవ్వండి.',
    stageReady: (n, title, difficulty, count) => `దశ ${n}: ${title}. ${difficulty}. గరిష్ఠంగా ${count} ప్రశ్నలు. తర్వాతి దశను తెరవడానికి కనీసం 70 శాతం సరైన సమాధానాలు ఇవ్వండి.`,
    stageCustom: 'మీ సవాలు. కష్టాన్ని, ప్రశ్నల సంఖ్యను ఎంచుకోండి.',
    stagePassed: (n, next) => `చాలా బాగా ఆడారు! దశ ${n} పూర్తయింది. దశ ${next} తెరుచుకుంది.`,
    stageFailed: n => `దశ ${n} ఇంకా తెరుచుకోలేదు. మళ్లీ ప్రయత్నించి కనీసం 70 శాతం సరైన సమాధానాలు ఇవ్వండి.`,
    stageMastered: 'అద్భుతం! చివరి క్విజ్ దశను కూడా పూర్తి చేశారు.',
    stageProgress: (n, max) => `${max} దశల్లో ${n}వ దశ తెరుచుకుంది.`,
    teluguNote: count => `తెలుగు ప్రారంభ ప్యాక్‌లో ఎంపిక చేసిన అంశాలపై ${count} ప్రశ్నలు ఉన్నాయి. మరిన్ని తెలుగు అంశాలు తర్వాతి నవీకరణల్లో చేరతాయి.`,
    question: (current, total) => `${total} ప్రశ్నల్లో ${current}వ ప్రశ్న`,
    answerChoices: 'సమాధాన ఎంపికలు', options: 'ఎంపికలు', option: (letter, answer) => `ఎంపిక ${letter}: ${answer}. ఎంచుకోవడానికి రెండుసార్లు నొక్కండి.`, optionResult: (letter, answer) => `ఎంపిక ${letter}: ${answer}`, correctLabel: 'సరైన సమాధానం', incorrectLabel: 'తప్పు', yourAnswer: 'మీ సమాధానం',
    correct: 'సరైన సమాధానం!', incorrectTitle: 'తప్పు సమాధానం.', incorrect: answer => `తప్పు సమాధానం. సరైన సమాధానం ${answer}.`,
    correctAnswer: answer => `సరైన సమాధానం ${answer}.`, yourChoice: (choice, answer) => `మీరు ${choice} ఎంచుకున్నారు. సరైన సమాధానం ${answer}.`,
    streak: n => `వరుసగా ${n} సరైన సమాధానాలు.`, streakReset: 'వరుస సమాధానాలు మళ్లీ మొదలవుతాయి.', earnLogin: 'XP, నాణేలు సంపాదించడానికి సైన్ ఇన్ చేయండి.',
    xpCoins: (xp, coins) => `మీకు ${xp} XP, ${coins} నాణేలు వచ్చాయి.`, alreadyRewarded: 'ఈ ప్రశ్నకు మునుపటి రౌండ్‌లోనే బహుమతి పొందారు.',
    sessionEnded: 'మీ సెషన్ ముగిసింది. ప్రగతిని భద్రపరచడానికి మళ్లీ సైన్ ఇన్ చేయండి.', saveOffline: 'ఈ సమాధానాన్ని ప్రొఫైల్‌లో భద్రపరచలేకపోయాం; అయినా రౌండ్ కొనసాగించవచ్చు.',
    getReady: 'సిద్ధంగా ఉండండి!', getReadyCopy: 'మీ రౌండ్ మొదలవుతోంది.', starting: 'ప్రారంభమవుతోంది…',
    go: 'మొదలు!', timer: seconds => `ఇంకా ${seconds} ${seconds===1?'సెకన్':'సెకన్లు'} ఉన్నాయి.`,
    repeat: 'ప్రశ్నను, ఎంపికలను మళ్లీ వినండి', roundStatus: 'రౌండ్ స్థితి వినండి',
    playQuiz: 'క్విజ్ ఆడండి', answerAgain: 'తర్వాతి ప్రశ్న', viewResults: 'ఫలితాలు చూడండి',
    autoAdvance: (seconds, action, finalStep) => finalStep ? `${seconds} సెకన్లలో ఫలితాలు కనిపిస్తాయి. ఇప్పుడే చూడడానికి ${action} ఎంచుకోండి.` : `${seconds} సెకన్లలో తర్వాతి ప్రశ్న ప్రారంభమవుతుంది. ఇప్పుడే కొనసాగడానికి ${action} ఎంచుకోండి.`,
    resultScore: (score, total) => `${total}లో ${score} సరైన సమాధానాలు`,
    roundComplete: (score, total) => `రౌండ్ పూర్తయింది. ${total}లో ${score} సరైన సమాధానాలు.`,
    resultPerfect: 'అద్భుతం! అన్ని సమాధానాలూ సరైనవి.',
    resultStrong: 'చాలా మంచి రౌండ్. ఇలాగే కొనసాగించండి.',
    resultTryAgain: 'ప్రతి ప్రశ్న నుంచి కొత్త విషయం నేర్చుకోవచ్చు.',
    survivalEnded: 'ఒక తప్పు సమాధానంతో సర్వైవల్ రౌండ్ ముగిసింది. మళ్లీ ఆడి ఎంతసేపు కొనసాగగలరో చూడండి.',
    welcome: 'బ్లైండ్ క్విజ్‌కు స్వాగతం. ఇది కె. ఎం. సంజయ్ రూపొందించిన అందరికీ అందుబాటులో ఉండే క్విజ్ ఆట. స్క్రీన్ రీడర్ ప్రకటనలు ఆన్‌లో ఉన్నాయి. నావిగేట్ చేయడానికి కుడివైపు స్వైప్ చేయండి లేదా Next నొక్కండి.',
    ready: 'బ్లైండ్ క్విజ్ సిద్ధంగా ఉంది. వర్గాన్ని ఎంచుకోండి లేదా రౌండ్ ప్రారంభించండి.', settingsSaved: 'సెట్టింగ్‌లు భద్రపరచబడ్డాయి.',
    moreTelugu: 'తెలుగు ప్రారంభ ప్యాక్‌లో ఎంపిక చేసిన అంశాలే ఉన్నాయి. తెలుగులో మాటల సూచనల కోసం పరికరంలో తెలుగు టెక్స్ట్-టు-స్పీచ్ స్వరం ఉండాలి. అన్ని ప్రశ్నల కోసం English ఎంచుకోండి.', notAvailable: 'మరిన్ని తెలుగు ప్రశ్నలు త్వరలో చేరతాయి.',
    noQuestions: 'ఈ ఎంపికకు సరిపడా ప్రశ్నలు ఈ వర్గంలో ఇంకా లేవు.',
    starterCategories: 'తెలుగు ప్రారంభ అంశాలు',
    signInStatus: 'సైన్ ఇన్ చేశారు:',
  },
};

const CATEGORY_TE = {
  animals: 'జంతువులు', birds: 'పక్షులు', nature: 'ప్రకృతి', instruments: 'సంగీత వాయిద్యాలు',
  science: 'విజ్ఞానం', geography: 'భూగోళ శాస్త్రం', india: 'భారతదేశం', braille: 'బ్రెయిల్',
  history: 'చరిత్ర', sports: 'క్రీడలు', civics: 'పౌరశాస్త్రం', music: 'సంగీతం',
};

const CATEGORY_DESCRIPTION_TE = {
  animals: 'జంతువులు మరియు వాటి జీవితం', birds: 'పక్షులు మరియు వాటి లక్షణాలు', nature: 'ప్రకృతి, భూమి, జీవ వ్యవస్థలు',
  instruments: 'సంగీత వాయిద్యాలు మరియు వాటి శబ్దాలు', science: 'శాస్త్రం, మొక్కలు, శరీరం',
  geography: 'దేశాలు, నగరాలు, మహాసముద్రాలు', india: 'భారతదేశం మరియు దాని ప్రజలు', braille: 'ఆరు చుక్కల బ్రెయిల్ నమూనాలు',
  history: 'చరిత్రలోని వ్యక్తులు, సంఘటనలు', sports: 'క్రీడలు మరియు వాటి నియమాలు', civics: 'భారత ప్రభుత్వ వ్యవస్థలు', music: 'లయ, శబ్దం, సంగీత ఆలోచనలు',
};

const MODE_TE = {
  classic: ['సాధారణ క్విజ్', 'వేర్వేరు అంశాల నుంచి సమతుల్యమైన ప్రశ్నలు.'],
  rapid: ['వేగంగా ఆడండి', 'ప్రతి ప్రశ్నకు 15 సెకన్ల గడియారం.'],
  timeattack: ['సమయ సవాలు', 'ప్రతి ప్రశ్నకు 10 సెకన్ల గడియారం.'],
  survival: ['సర్వైవల్', 'తప్పు సమాధానం వచ్చే వరకు కొనసాగించండి.'],
  random: ['యాదృచ్ఛిక మిశ్రమం', 'అందుబాటులో ఉన్న ప్రశ్నల నుంచి ఎంచుకుంటుంది.'],
  vocabulary: ['పదజాలం', 'పదాల అర్థాలు, వాడుక, స్పెల్లింగ్.'],
  abbreviations: ['సంక్షిప్త రూపాలు', 'సాధారణ సంక్షిప్త రూపాల అర్థం తెలుసుకోండి.'],
  braille: ['బ్రెయిల్', 'ఆరు చుక్కల నమూనాలతో పరిచయం పొందండి.'],
  yesno: ['అవును లేదా కాదు', 'ఇచ్చిన సమాధానం సరైందో కాదో చెప్పండి.'],
  decision: ['రెండు ఎంపికలు', 'రెండు సమాధానాల్లో సరైనదాన్ని ఎంచుకోండి.'],
  quickdecision: ['వేగ నిర్ణయం', 'ఐదు సెకన్లలో రెండు ఎంపికల్లో సరైనదాన్ని ఎంచుకోండి.'],
  letters: ['అక్షరాలతో పదాలు', 'విన్న లేదా చూసిన అక్షరాలతో పదాలు నిర్మించండి.'],
};

const STAGE_NAMES = [
  ['First Steps', 'మొదటి అడుగు'], ['Curious Explorer', 'ఆసక్తికర అన్వేషకుడు'], ['Bright Thinker', 'తెలివైన ఆలోచనాపరుడు'],
  ['Animal Friend', 'జంతు మిత్రుడు'], ['Nature Detective', 'ప్రకృతి అన్వేషకుడు'], ['Knowledge Builder', 'జ్ఞాన సాధకుడు'],
  ['Quick Thinker', 'వేగంగా ఆలోచించేవాడు'], ['Pattern Finder', 'నమూనాలను కనుగొనేవాడు'], ['Braille Pathfinder', 'బ్రెయిల్ మార్గదర్శి'],
  ['Challenge Seeker', 'సవాళ్లను స్వీకరించేవాడు'], ['Quiz Champion', 'క్విజ్ విజేత'], ['Master Explorer', 'మేటి అన్వేషకుడు'],
];

export function uiText(language, key, ...args) {
  const entry = UI[language]?.[key] ?? UI.en[key] ?? key;
  return typeof entry === 'function' ? entry(...args) : entry;
}

export function categoryLabel(language, category) {
  return language === 'te' ? (CATEGORY_TE[category.id] || category.name) : category.name;
}

export function categoryDescription(language, category) {
  return language === 'te' ? (CATEGORY_DESCRIPTION_TE[category.id] || category.description) : category.description;
}

export function modeLabel(language, mode, fallbackName, fallbackDescription) {
  return language === 'te' ? (MODE_TE[mode] || [fallbackName, fallbackDescription]) : [fallbackName, fallbackDescription];
}

export function stageLabel(language, index) {
  return STAGE_NAMES[index]?.[language === 'te' ? 1 : 0] || `Stage ${index + 1}`;
}

export const TELUGU_QUESTIONS = {
  'bq-en-0001': { question: 'భూమిపై నివసించే అతిపెద్ద క్షీరదం ఏది?', answers: { 'African elephant': 'ఆఫ్రికన్ ఏనుగు', Giraffe: 'జిరాఫీ', Hippopotamus: 'నీటిగుర్రం', 'White rhinoceros': 'తెల్ల ఖడ్గమృగం' }, explanation: 'భూమిపై నివసించే అతిపెద్ద క్షీరదం ఆఫ్రికన్ ఏనుగు.' },
  'bq-en-0002': { question: 'గుడ్లు పెట్టే క్షీరదం ఏది?', answers: { Platypus: 'ప్లాటిపస్', Dolphin: 'డాల్ఫిన్', Bat: 'గబ్బిలం', Koala: 'కోఆలా' }, explanation: 'ప్లాటిపస్ గుడ్లు పెట్టే క్షీరదం.' },
  'bq-en-0006': { question: 'ఇవాటిలో సరీసృపం కాకుండా ఉభయచరం ఏది?', answers: { Frog: 'కప్ప', Lizard: 'బల్లి', Turtle: 'తాబేలు', Snake: 'పాము' }, explanation: 'కప్పలు నీటిలోనూ నేలమీదనూ జీవిస్తాయి; అందుకే అవి ఉభయచరాలు.' },
  'bq-en-0007': { question: 'ధ్రువ ఎలుగుబంట్లు అడవిలో ఎక్కడ నివసిస్తాయి?', answers: { 'The Arctic': 'ఆర్కిటిక్ ప్రాంతం', Antarctica: 'అంటార్కిటికా', 'The Sahara': 'సహారా ఎడారి', 'The Amazon basin': 'అమెజాన్ నదీ పరీవాహక ప్రాంతం' }, explanation: 'ధ్రువ ఎలుగుబంట్లు ఉత్తర ధ్రువ ప్రాంతమైన ఆర్కిటిక్‌లో నివసిస్తాయి.' },
  'bq-en-0012': { question: 'ఎగరలేకపోయినా బాగా ఈదగల పక్షి ఏది?', answers: { Penguin: 'పెంగ్విన్', Swift: 'స్విఫ్ట్ పక్షి', Kingfisher: 'కింగ్‌ఫిషర్', Albatross: 'ఆల్బట్రాస్' }, explanation: 'పెంగ్విన్లు ఎగరలేవు; కానీ సముద్రంలో అద్భుతంగా ఈదుతాయి.' },
  'bq-en-0015': { question: 'పక్షి శరీరాన్ని కప్పి, వెచ్చదనానికి మరియు ఎగరడానికి సహాయపడేవి ఏమిటి?', answers: { Feathers: 'ఈకలు', Scales: 'పొలుసులు', Fur: 'బొచ్చు', 'Shell plates': 'గట్టి కవచపు పలకలు' }, explanation: 'ఈకలు పక్షులకు వెచ్చదనాన్ని ఇస్తాయి; ఎగరడంలోనూ సహాయపడతాయి.' },
  'bq-en-0016': { question: 'భారతదేశ జాతీయ పక్షి ఏది?', answers: { 'Indian peafowl': 'భారతీయ నెమలి', 'House sparrow': 'ఇంటి పిచ్చుక', 'Rose-ringed parakeet': 'గులాబీ వలయపు చిలుక', 'Sarus crane': 'సారస్ కొంగ' }, explanation: 'భారతదేశ జాతీయ పక్షి భారతీయ నెమలి.' },
  'bq-en-0019': { question: 'చాలా మొక్కల్లో నేల నుంచి నీటిని పీల్చుకునే భాగం ఏది?', answers: { Roots: 'వేర్లు', Petals: 'రేకులు', Fruit: 'పండు', Bark: 'చెట్టు బెరడు' }, explanation: 'మొక్కల వేర్లు నేల నుంచి నీటిని, ఖనిజాలను పీల్చుకుంటాయి.' },
  'bq-en-0021': { question: 'భూమిపై అతి పెద్ద మహాసముద్రం ఏది?', answers: { 'Pacific Ocean': 'పసిఫిక్ మహాసముద్రం', 'Atlantic Ocean': 'అట్లాంటిక్ మహాసముద్రం', 'Indian Ocean': 'హిందూ మహాసముద్రం', 'Arctic Ocean': 'ఆర్కిటిక్ మహాసముద్రం' }, explanation: 'పసిఫిక్ మహాసముద్రం భూమిపై అతి పెద్ద మహాసముద్రం.' },
  'bq-en-0023': { question: 'గాలి ఉష్ణోగ్రతను కొలిచే పరికరం ఏది?', answers: { Thermometer: 'థర్మామీటర్', Barometer: 'బారోమీటర్', 'Rain gauge': 'వర్షమాపకం', Compass: 'దిక్సూచి' }, explanation: 'థర్మామీటర్ ఉష్ణోగ్రతను కొలుస్తుంది.' },
  'bq-en-0031': { question: 'జీవుల నిర్మాణానికి ప్రాథమిక ఘటకం ఏది?', answers: { Cell: 'కణం', Atom: 'పరమాణువు', Organ: 'అవయవం', Tissue: 'కణజాలం' }, explanation: 'కణం జీవుల నిర్మాణానికి ప్రాథమిక ఘటకం.' },
  'bq-en-0032': { question: 'వస్తువులను భూమి వైపు లాగే బలం ఏది?', answers: { Gravity: 'గురుత్వాకర్షణ', Friction: 'ఘర్షణ', Magnetism: 'అయస్కాంత బలం', Buoyancy: 'తేలే బలం' }, explanation: 'గురుత్వాకర్షణ వస్తువులను భూమి వైపు లాగుతుంది.' },
  'bq-en-0035': { question: 'స్పష్టమైన వలయాలకు ప్రసిద్ధి చెందిన గ్రహం ఏది?', answers: { Saturn: 'శని', Mercury: 'బుధుడు', Mars: 'అంగారకుడు', Venus: 'శుక్రుడు' }, explanation: 'శని గ్రహం చుట్టూ అందమైన వలయాలు ఉన్నాయి.' },
  'bq-en-0039': { question: 'అత్యధిక భూభాగం కలిగిన ఖండం ఏది?', answers: { Asia: 'ఆసియా', Africa: 'ఆఫ్రికా', Europe: 'యూరప్', 'South America': 'దక్షిణ అమెరికా' }, explanation: 'ఆసియా భూమిపై అతి పెద్ద ఖండం.' },
  'bq-en-0040': { question: 'జపాన్ రాజధాని ఏది?', answers: { Tokyo: 'టోక్యో', Kyoto: 'క్యోటో', Osaka: 'ఒసాకా', Sapporo: 'సప్పోరో' }, explanation: 'జపాన్ రాజధాని టోక్యో.' },
  'bq-en-0041': { question: 'తెలంగాణ రాజధాని ఏ నగరం?', answers: { Hyderabad: 'హైదరాబాద్', Warangal: 'వరంగల్', Karimnagar: 'కరీంనగర్', Nizamabad: 'నిజామాబాద్' }, explanation: 'తెలంగాణ రాజధాని హైదరాబాద్.' },
  'bq-en-0044': { question: 'భారత రాజ్యాంగం ఏ తేదీన అమల్లోకి వచ్చింది?', answers: { '26 January 1950': '26 జనవరి 1950', '15 August 1947': '15 ఆగస్టు 1947', '26 November 1949': '26 నవంబర్ 1949', '2 October 1950': '2 అక్టోబర్ 1950' }, explanation: 'భారత రాజ్యాంగం 26 జనవరి 1950న అమల్లోకి వచ్చింది.' },
  'bq-en-0046': { question: 'తెలుగు లిపిలో ప్రధానంగా రాసే భాష ఏది?', answers: { Telugu: 'తెలుగు', Gujarati: 'గుజరాతీ', Bengali: 'బెంగాలీ', Punjabi: 'పంజాబీ' }, explanation: 'తెలుగు భాషను ప్రధానంగా తెలుగు లిపిలో రాస్తారు.' },
  'bq-en-0048': { question: 'రెండవ ప్రపంచ యుద్ధం ఏ సంవత్సరంలో ముగిసింది?', answers: { '1945': '1945', '1939': '1939', '1944': '1944', '1947': '1947' }, explanation: 'రెండవ ప్రపంచ యుద్ధం 1945లో ముగిసింది.' },
  'bq-en-0052': { question: 'క్రికెట్‌లో ఒక జట్టు బౌలింగ్ చేస్తున్నప్పుడు మైదానంలో ఎంతమంది ఆటగాళ్లు ఉంటారు?', answers: { Eleven: 'పదకొండు', Nine: 'తొమ్మిది', Ten: 'పది', Twelve: 'పన్నెండు' }, explanation: 'క్రికెట్‌లో ఫీల్డింగ్ చేస్తున్న జట్టులో పదకొండు మంది ఆటగాళ్లు ఉంటారు.' },
  'bq-en-0053': { question: 'షటిల్‌కాక్ ఉపయోగించే ఆట ఏది?', answers: { Badminton: 'బ్యాడ్మింటన్', Tennis: 'టెన్నిస్', 'Table tennis': 'టేబుల్ టెన్నిస్', Squash: 'స్క్వాష్' }, explanation: 'బ్యాడ్మింటన్‌లో షటిల్‌కాక్‌ను ఉపయోగిస్తారు.' },
  'bq-en-0054': { question: 'భారత పార్లమెంట్‌లో దిగువ సభ ఏది?', answers: { 'Lok Sabha': 'లోక్‌సభ', 'Rajya Sabha': 'రాజ్యసభ', 'Supreme Court': 'సుప్రీంకోర్టు', 'Election Commission': 'ఎన్నికల సంఘం' }, explanation: 'లోక్‌సభ భారత పార్లమెంట్‌లో దిగువ సభ.' },
  'bq-en-0056': { question: 'సంగీతాన్ని క్రమబద్ధం చేసే స్థిరమైన లయను ఏమంటారు?', answers: { Beat: 'లయ', Timbre: 'స్వరరంగు', Pitch: 'స్వరస్థాయి', Harmony: 'సామరస్యం' }, explanation: 'సంగీతంలో బీట్ అనేది క్రమంగా వినిపించే ప్రాథమిక లయ.' },
  'bq-en-0003': { question: 'సింహాల సమూహాన్ని సాధారణంగా ఏమంటారు?', answers: { 'A pride': 'ప్రైడ్ (సింహాల గుంపు)', 'A herd': 'మంద', 'A pack': 'ప్యాక్', 'A colony': 'కాలనీ' }, explanation: 'సింహాల గుంపును ఇంగ్లీషులో ప్రైడ్ అంటారు.' },
  'bq-en-0004': { question: 'ఒంటె మూపురం ప్రధానంగా దేనిని నిల్వ చేస్తుంది?', answers: { 'To store fat': 'కొవ్వును నిల్వ చేయడానికి', 'To store water': 'నీటిని నిల్వ చేయడానికి', 'To keep its brain cool': 'మెదడును చల్లగా ఉంచడానికి', 'To hold food for its young': 'పిల్లల కోసం ఆహారాన్ని దాచడానికి' }, explanation: 'ఒంటె మూపురంలో నీరు కాదు, కొవ్వు నిల్వ ఉంటుంది.' },
  'bq-en-0005': { question: 'దారి తెలుసుకోవడానికి ప్రతిధ్వని స్థాన నిర్ధారణను ఉపయోగించే జంతువు ఏది?', answers: { Bat: 'గబ్బిలం', Rabbit: 'కుందేలు', Horse: 'గుర్రం', Panda: 'పాండా' }, explanation: 'గబ్బిలాలు శబ్ద ప్రతిధ్వనులను ఉపయోగించి చుట్టూ ఉన్న వస్తువులను గుర్తిస్తాయి.' },
  'bq-en-0008': { question: 'పెద్ద పురుగుకు ఎన్ని కాళ్లు ఉంటాయి?', answers: { Six: 'ఆరు', Four: 'నాలుగు', Eight: 'ఎనిమిది', Ten: 'పది' }, explanation: 'పెద్ద పురుగులకు ఆరు కాళ్లు ఉంటాయి.' },
  'bq-en-0010': { question: 'భారతదేశానికి చెందిన, దేశ జాతీయ జంతువుగా కూడా గుర్తింపు పొందిన పెద్ద అడవి పిల్లి ఏది?', answers: { 'Bengal tiger': 'బెంగాల్ పులి', 'Asiatic lion': 'ఆసియా సింహం', 'Snow leopard': 'మంచు చిరుత', 'Clouded leopard': 'మేఘ చిరుత' }, explanation: 'బెంగాల్ పులి భారతదేశ జాతీయ జంతువు.' },
  'bq-en-0020': { question: 'కిరణజన్య సంయోగక్రియలో పచ్చని మొక్కలు ఏ వాయువును గ్రహిస్తాయి?', answers: { 'Carbon dioxide': 'కార్బన్ డైఆక్సైడ్', Oxygen: 'ఆక్సిజన్', Nitrogen: 'నైట్రోజన్', Helium: 'హీలియం' }, explanation: 'కిరణజన్య సంయోగక్రియలో మొక్కలు కార్బన్ డైఆక్సైడ్‌ను గ్రహిస్తాయి.' },
  'bq-en-0027': { question: 'జతగా చేతులతో వాయించే భారతీయ తాళ వాయిద్యం ఏది?', answers: { Tabla: 'తబలా', Veena: 'వీణ', Sitar: 'సితార్', Bansuri: 'వేణువు' }, explanation: 'తబలా రెండు చిన్న డ్రమ్‌ల జత; చేతులతో వాయిస్తారు.' },
  'bq-en-0034': { question: 'మానవ శరీరమంతా రక్తాన్ని పంపే అవయవం ఏది?', answers: { Heart: 'గుండె', Liver: 'కాలేయం', Lung: 'ఊపిరితిత్తి', Kidney: 'మూత్రపిండం' }, explanation: 'గుండె రక్తాన్ని శరీరమంతా పంపుతుంది.' },
  'bq-en-0036': { question: 'విద్యుత్ ప్రవాహానికి SI ప్రమాణం ఏది?', answers: { Ampere: 'ఆంపియర్', Volt: 'వోల్ట్', Watt: 'వాట్', Ohm: 'ఓమ్' }, explanation: 'విద్యుత్ ప్రవాహానికి SI ప్రమాణం ఆంపియర్.' },
  'bq-en-0045': { question: 'విస్తీర్ణం ప్రకారం భారతదేశంలో అతిపెద్ద రాష్ట్రం ఏది?', answers: { Rajasthan: 'రాజస్థాన్', 'Madhya Pradesh': 'మధ్యప్రదేశ్', Maharashtra: 'మహారాష్ట్ర', 'Uttar Pradesh': 'ఉత్తరప్రదేశ్' }, explanation: 'విస్తీర్ణం ప్రకారం రాజస్థాన్ భారతదేశంలో అతిపెద్ద రాష్ట్రం.' },
  'bq-en-0047': { question: 'దక్షిణ గంగ అని పిలిచే నది ఏది?', answers: { Godavari: 'గోదావరి', Krishna: 'కృష్ణా', Kaveri: 'కావేరి', Narmada: 'నర్మదా' }, explanation: 'గోదావరి నదిని తరచుగా దక్షిణ గంగ అని పిలుస్తారు.' },
  'bq-en-0072': { question: 'బ్రెయిల్‌లో 2, 4, 5 చుక్కలు ఏ అక్షరాన్ని సూచిస్తాయి?', answers: { J: 'J', N: 'N', S: 'S', W: 'W' }, explanation: 'ప్రామాణిక బ్రెయిల్‌లో 2, 4, 5 చుక్కల నమూనా J అక్షరాన్ని సూచిస్తుంది.' },
  'bq-en-0602': { question: 'బ్రెయిల్‌లో 1, 2, 3, 4 చుక్కలను ఉపయోగించే అక్షరం ఏది?', answers: { P: 'P', R: 'R', V: 'V', X: 'X' }, explanation: 'P అక్షరానికి బ్రెయిల్ చుక్కలు 1, 2, 3, 4 ఉపయోగిస్తారు.' },
  'bq-en-0603': { question: 'బ్రెయిల్ అక్షరం Qను ఏ చుక్కలు సూచిస్తాయి?', answers: { 'Dots 1, 2, 3, 4, and 5': '1, 2, 3, 4, 5 చుక్కలు', 'Dots 1, 2, 3, and 5': '1, 2, 3, 5 చుక్కలు', 'Dots 1, 2, 4, and 5': '1, 2, 4, 5 చుక్కలు', 'Dots 1, 3, 4, and 5': '1, 3, 4, 5 చుక్కలు' }, explanation: 'బ్రెయిల్‌లో Q అక్షరానికి 1, 2, 3, 4, 5 చుక్కలు ఉపయోగిస్తారు.' },
  'bq-en-0820': { question: 'బ్రెయిల్‌లో 1, 2, 3, 5 చుక్కలను ఉపయోగించే అక్షరం ఏది?', answers: { R: 'R', P: 'P', Q: 'Q', L: 'L' }, explanation: 'R అక్షరానికి బ్రెయిల్ చుక్కలు 1, 2, 3, 5 ఉపయోగిస్తారు.' },
  'bq-en-0821': { question: 'బ్రెయిల్ అక్షరం Tను ఏ చుక్కలు సూచిస్తాయి?', answers: { 'Dots 2, 3, 4, and 5': '2, 3, 4, 5 చుక్కలు', 'Dots 2, 3, and 4': '2, 3, 4 చుక్కలు', 'Dots 1, 3, 4, and 5': '1, 3, 4, 5 చుక్కలు', 'Dots 2, 4, and 5': '2, 4, 5 చుక్కలు' }, explanation: 'T అక్షరానికి బ్రెయిల్ చుక్కలు 2, 3, 4, 5 ఉపయోగిస్తారు.' },
  'bq-en-0823': { question: 'బ్రెయిల్ అక్షరం Vను ఏ చుక్కలు సూచిస్తాయి?', answers: { 'Dots 1, 2, 3, and 6': '1, 2, 3, 6 చుక్కలు', 'Dots 1, 3, and 6': '1, 3, 6 చుక్కలు', 'Dots 1, 2, 3, and 5': '1, 2, 3, 5 చుక్కలు', 'Dots 2, 4, 5, and 6': '2, 4, 5, 6 చుక్కలు' }, explanation: 'V అక్షరానికి బ్రెయిల్ చుక్కలు 1, 2, 3, 6 ఉపయోగిస్తారు.' },
  'bq-en-0824': { question: 'బ్రెయిల్‌లో 2, 4, 5, 6 చుక్కలను ఉపయోగించే అక్షరం ఏది?', answers: { W: 'W', J: 'J', T: 'T', Y: 'Y' }, explanation: 'W అక్షరానికి బ్రెయిల్ చుక్కలు 2, 4, 5, 6 ఉపయోగిస్తారు.' },
  'bq-en-0825': { question: 'బ్రెయిల్ అక్షరం Xను ఏ చుక్కలు సూచిస్తాయి?', answers: { 'Dots 1, 3, 4, and 6': '1, 3, 4, 6 చుక్కలు', 'Dots 1, 3, 4, 5, and 6': '1, 3, 4, 5, 6 చుక్కలు', 'Dots 1, 3, 5, and 6': '1, 3, 5, 6 చుక్కలు', 'Dots 1, 3, and 6': '1, 3, 6 చుక్కలు' }, explanation: 'X అక్షరానికి బ్రెయిల్ చుక్కలు 1, 3, 4, 6 ఉపయోగిస్తారు.' },
  'bq-en-0826': { question: 'బ్రెయిల్‌లో 1, 3, 4, 5, 6 చుక్కలను ఉపయోగించే అక్షరం ఏది?', answers: { Y: 'Y', X: 'X', Z: 'Z', Q: 'Q' }, explanation: 'Y అక్షరానికి బ్రెయిల్ చుక్కలు 1, 3, 4, 5, 6 ఉపయోగిస్తారు.' },
};

const TELUGU_EXPERT_IDS = new Set(['bq-en-0823', 'bq-en-0824', 'bq-en-0825', 'bq-en-0826']);

export function localizedQuestion(question, language = 'en') {
  if (language !== 'te') return question;
  const translated = TELUGU_QUESTIONS[question?.id];
  if (!translated) return null;
  const answers = question.answers.map(source => translated.answers[source]);
  if (answers.some(answer => typeof answer !== 'string' || !answer.trim()) || new Set(answers).size !== answers.length) return null;
  const sourceAnswerByDisplay = Object.fromEntries(question.answers.map((source, index) => [answers[index], source]));
  return {
    ...question,
    question: translated.question,
    answers,
    correctAnswer: translated.answers[question.correctAnswer],
    explanation: translated.explanation,
    sourceAnswerByDisplay,
    language: 'te',
    ...(TELUGU_EXPERT_IDS.has(question.id) ? { difficulty: 'expert' } : {}),
  };
}

export function localizedBank(questionBank, language = 'en') {
  return language === 'te' ? questionBank.map(q => localizedQuestion(q, 'te')).filter(Boolean) : questionBank;
}

export function instructionText(language = 'en') {
  return language === 'te'
    ? 'బ్లైండ్ క్విజ్‌కు స్వాగతం. ముందుగా ఆట భాషను ఎంచుకోండి. క్విజ్ దశ, కష్టం, ఒక్కో రౌండ్‌లోని ప్రశ్నల సంఖ్యను ఎంచుకుని ఇప్పుడే ఆడండి నొక్కండి. ప్రశ్నను వినండి. సరైన సమాధానాన్ని ఎంచుకోవడానికి A, B, C లేదా D ఎంపికను తాకండి. సరైన సమాధానానికి ఒక శబ్దం, తప్పు సమాధానానికి వేరొక శబ్దం వినిపిస్తుంది. ప్రశ్నను మళ్లీ వినడానికి ప్రశ్నను, ఎంపికలను మళ్లీ వినండి అనే బటన్‌ను నొక్కండి. అవసరమైతే మీ స్క్రీన్ రీడర్‌ను ఉపయోగించండి.'
    : 'Welcome to Blind Quiz. Choose a language, a quiz stage or difficulty, and how many questions you want. Press Play now to begin. Listen to the question, then choose A, B, C, or D. A clear sound and spoken feedback tell you whether your answer was right. Use Hear question and options again to repeat a question. You can play by touch, keyboard, mouse, or screen reader.';
}
