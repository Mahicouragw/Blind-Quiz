import { initAlertSettings } from './alerts.js';
import { QUESTION_BANK, CATEGORY_LIST } from './content.js';
import { callApi, getSession, setSession } from './backend.js';
import { shuffled } from './random.js';
import { GAME_MODES, presentQuestion, poolFor as poolForQuestions, selectRoundQuestions, timeLimitFor, endsAfterMiss } from './game-logic.js';
import { playSfx as rawSfx, playSequence as rawSequence, playMusic, stopMusic, musicFor, configureAudio, preloadAudio, unlockAudio, matchSounds, playMatchSound as rawMatch, stopMatchSound } from './audio.js';
import { createSoundMatch } from './sound-match-ui.js';
import { createCountMatch as createCountMatchUI } from './count-match-ui.js';
import { createLettersGame } from './letters-ui.js';
import { createFeedback } from './feedback.js';
import { createAdminMonitor } from './admin-monitor.js';
import { createAccountManagement } from './account-management.js';
import { createModeration } from './moderation.js';
import { createSocial } from './social.js';
import { createChat } from './chat.js';
import { createRooms } from './rooms.js';
import { createRoomPlay } from './room-play.js';
import { createDirect } from './direct.js';
import { configureSpeech, speechPrefs, speak, speakOnly, speakPreview, cancelSpeech, speechVoices, speechSupported } from './speech.js';
import { initGestures, moveFocus } from './gestures.js';
import { categoryDescription, categoryLabel, instructionText, localizedBank, modeLabel, stageLabel, uiText } from './language.js';
import { normalizedUnlockedStage, questionMatchesDifficulty, QUIZ_STAGES, stagePasses } from './quiz-levels.js';
// The app keeps its own document and WIN. A page never swaps them, but a timer that outlives the
// page must never reach into a different DOC.
const DOC=typeof document!=='undefined'?document:null,WIN=typeof window!=='undefined'?window:null;
const $=(s,root=DOC)=>root?root.querySelector(s):null, $$=(s,root=DOC)=>root?[...root.querySelectorAll(s)]:[];
const state={view:'home',category:'general',mode:'classic',difficulty:'all',questions:[],index:0,score:0,answered:false,answeredCount:0,lastAnswerCorrect:null,timer:null,timeLeft:0,locked:false,activeStageId:0,roundLanguage:'en',settings:{largeText:false,highContrast:false,reducedMotion:false,talkBackEnabled:true,timer:0,autoAdvanceSeconds:6,sfx:true,music:true,musicVolume:0.25,sfxVolume:0.8,autoStart:true,swipe:true,voiceMode:'screen',voicePitch:1,voiceRate:1,voiceVolume:1,voiceName:'',
  language:'en',quizDifficulty:'all',quizRoundLength:10,quizStage:0},profile:null,roundId:0,countdownFor:-1};
let talkBackEnabled=true;
// The round that is currently opening: a second activation for the same round is ignored.
let openingRoundFor='';
let audioReady=false;
const modes=[...GAME_MODES,['letters','Letters to Words','Build words using the letters you hear.']];
// Room games (Task 19 stage D): while playing a room game, what the game says and plays is also sent to spectators,
// who replay it with their own settings. Nothing is sent outside a room game.
const LIVE_VIEWS={quiz:'game',letters:'letters',soundmatch:'soundmatch',roomplay:'room-game'};
const SYNC_ROOM_KINDS=new Set(['quiz','letters','soundmatch','snakes','ludo','carrom','blackjack','chess']);
let live=null,liveBuf=[],liveTimer=null,liveScore=-1,lastRoom=null,rooms=null,roomPlay=null;
function livePush(k,b){if(!live||live.kind==='roomplay'||(state.view!==LIVE_VIEWS[live.kind]&&state.view!=='results'))return;liveBuf.push({k,b:String(b??'').slice(0,400)});if(liveBuf.length>=40)liveFlush()}
function playSfx(slot,...a){livePush('sfx',slot);return rawSfx(slot,...a)}
function playSequence(slots,...a){for(const x of slots||[])livePush('sfx',x);return rawSequence(slots,...a)}
function playMatchSound(slot,...a){livePush('match',slot);return rawMatch(slot,...a)}
let pendingAccessibilityUpdate=null,liveRegionObserver=null;
const mutedLiveRegions=new WeakMap(),oneShotLiveRegions=new WeakSet();
function clearPendingAccessibilityUpdate(){if(pendingAccessibilityUpdate!==null)clearTimeout(pendingAccessibilityUpdate);pendingAccessibilityUpdate=null}
function isLiveRegion(element){return element?.nodeType===1&&(element.hasAttribute('aria-live')||['status','alert'].includes(element.getAttribute('role')))}
function muteLiveRegion(element){if(!mutedLiveRegions.has(element))mutedLiveRegions.set(element,{had:element.hasAttribute('aria-live'),value:element.getAttribute('aria-live')});if(element.getAttribute('aria-live')!=='off')element.setAttribute('aria-live','off')}
function restoreLiveRegion(element){const saved=mutedLiveRegions.get(element);if(!saved)return;if(saved.had)element.setAttribute('aria-live',saved.value);else element.removeAttribute('aria-live');mutedLiveRegions.delete(element)}
const voiceMode=()=>state.settings.voiceMode||'screen';
// The Android app tells the page when TalkBack (or another screen reader) is running, because a
// screen reader keeps single-finger swipes for itself. The hint then explains the two-finger
// swipe, the arrow keys and the Previous / Next buttons.
let screenReaderOn=false;
const gestureHintText=()=>screenReaderOn?ui('gestureHintScreenReader'):ui('gestureHint');
const refreshGestureHint=()=>{const el=DOC.getElementById('gesture-hint');if(el)el.textContent=gestureHintText()};
if(WIN)WIN.bqSetScreenReader=on=>{screenReaderOn=!!on;refreshGestureHint();if(on)announce(gestureHintText())};
// The game's own voice is only used when the player asks for it: 'screen' leaves the message to the
// screen reader, 'app' speaks it with the device voice, 'both' does both.
const speakMessage=text=>{if(voiceMode()==='screen')return false;return speak(text)};
const liveRegionsMuted=()=>!talkBackEnabled||voiceMode()==='app';
function syncLiveRegions(root=DOC){const elements=[];if(root?.nodeType===1&&isLiveRegion(root))elements.push(root);if(root?.querySelectorAll)elements.push(...root.querySelectorAll('[aria-live],[role="status"],[role="alert"]'));for(const element of elements){if(liveRegionsMuted())muteLiveRegion(element);else restoreLiveRegion(element)}}
function watchLiveRegions(){if(liveRegionObserver||!WIN.MutationObserver||!DOC?.documentElement)return;liveRegionObserver=new WIN.MutationObserver(records=>{if(!liveRegionsMuted())return;for(const record of records){if(record.type==='childList'){for(const node of record.addedNodes)if(node.nodeType===1)syncLiveRegions(node);continue}const element=record.target;if(oneShotLiveRegions.has(element))continue;const saved=mutedLiveRegions.get(element);if(saved&&element.getAttribute('aria-live')==='off')continue;if(isLiveRegion(element)){if(saved){saved.had=element.hasAttribute('aria-live');saved.value=element.getAttribute('aria-live')}muteLiveRegion(element)}else restoreLiveRegion(element)}});liveRegionObserver.observe(DOC.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-live','role']})}
function writeAccessibilityLiveRegion(text,urgent=false,{allowWhenDisabled=false}={}){if(!talkBackEnabled&&!allowWhenDisabled)return false;const region=$(urgent?'#assertive-announcer':'#announcer');if(!region)return false;clearPendingAccessibilityUpdate();const oneShot=!talkBackEnabled&&allowWhenDisabled;if(oneShot){oneShotLiveRegions.add(region);region.setAttribute('aria-live',urgent?'assertive':'polite')}region.textContent='';pendingAccessibilityUpdate=setTimeout(()=>{pendingAccessibilityUpdate=null;if(!talkBackEnabled&&!oneShot)return;region.textContent=String(text)},30);if(oneShot)setTimeout(()=>{oneShotLiveRegions.delete(region);if(!talkBackEnabled&&mutedLiveRegions.has(region))region.setAttribute('aria-live','off')},2500);return true}
function speakText(text,{language=['game','results'].includes(state.view)?state.roundLanguage:state.settings.language}={}){if(!talkBackEnabled)return false;const prefs=speechPrefs();if(prefs.volume<=0)return false;const synth=globalThis.speechSynthesis||WIN.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance||WIN.SpeechSynthesisUtterance;if(!synth||!Utterance)return false;try{const lang=language==='te'?'te-IN':'en-IN',voices=synth.getVoices?.()||[],voice=lang==='te-IN'?voices.find(v=>/^te(-|$)/i.test(v.lang)):voices.find(v=>/^en(-IN|-GB|-US|$)/i.test(v.lang));if(lang==='te-IN'&&voices.length&&!voice)return false;const chosen=prefs.voice&&voices.find(v=>(v.voiceURI||v.name)===prefs.voice);synth.cancel();const utterance=new Utterance(String(text));utterance.lang=lang;if(chosen&&(lang!=='te-IN'||/^te(-|$)/i.test(chosen.lang||'')))utterance.voice=chosen;else if(voice)utterance.voice=voice;const base=language==='te'?0.86:0.96;utterance.rate=Math.min(2,Math.max(0.5,base*prefs.rate));utterance.pitch=prefs.pitch;utterance.volume=prefs.volume;synth.speak(utterance);return true}catch{return false}}
function announceAccessibility(text,urgent=false,options={}){if(!talkBackEnabled&&!options.allowWhenDisabled)return false;return writeAccessibilityLiveRegion(text,urgent,options)}
function stopDeviceSpeech(){try{(globalThis.speechSynthesis||WIN.speechSynthesis)?.cancel()}catch{}}
function stopSpokenAnnouncements(){clearPendingAccessibilityUpdate();stopDeviceSpeech()}
function setTalkBackEnabled(enabled){const next=Boolean(enabled);if(next===talkBackEnabled){$('#talkback-enabled').checked=next;return}if(!next){stopSpokenAnnouncements();talkBackEnabled=false;state.settings.talkBackEnabled=false;$('#talkback-enabled').checked=false;persistQuizSettings();syncLiveRegions();announceAccessibility('TalkBack announcements turned OFF.',false,{allowWhenDisabled:true});return}talkBackEnabled=true;state.settings.talkBackEnabled=true;$('#talkback-enabled').checked=true;persistQuizSettings();syncLiveRegions();announceAccessibility('TalkBack announcements turned ON.')}
const announce=(text,urgent=false)=>{livePush('say',text);if(!talkBackEnabled)return false;const value=String(text).trim();speakMessage(value);const alreadyLive=[...DOC.querySelectorAll('[aria-live]:not([aria-live="off"]),[role="status"],[role="alert"]')].some(region=>region.id!=='announcer'&&region.id!=='assertive-announcer'&&region.getAttribute('aria-live')!=='off'&&!region.hidden&&!region.closest('[hidden]')&&region.textContent.trim()===value);return alreadyLive?false:announceAccessibility(text,urgent)};
const ui=(key,...args)=>uiText(['game','results'].includes(state.view)?state.roundLanguage:state.settings.language,key,...args);
const LETTERS=['A','B','C','D','E','F'];
// "B: Paris" for the answer that matches; used in results so the option letter is always spoken.
const optionName=(q,answer)=>{const i=q.displayAnswers.indexOf(answer);return i>=0?`${LETTERS[i]}: ${answer}`:answer};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Sub-views get one history entry, so the browser or Android back button returns to Home instead of leaving the app.
let skipPop=false;
function syncHistory(view){try{const inSub=!!history.state?.bqView;if(view==='home'){if(inSub){skipPop=true;history.back()}}else if(inSub)history.replaceState({bqView:view},'');else history.pushState({bqView:view},'')}catch{}}
// Exit confirmation (Task 19): leaving a game, a game mode or a room asks first. Finishing a round (results) never asks.
const EXIT_TEXT={game:['Exit this quiz?','Are you sure you want to exit? This round will end and its score will not be kept.'],letters:['Exit Letters to Words?','Are you sure you want to exit Letters to Words? Words you already found are saved.'],soundmatch:['Exit Sound Match?','Are you sure you want to exit Sound Match? This board will end.'],countmatch:['Exit Count Match?','Are you sure you want to exit? Your Count Match round will end.'],room:['Leave this room?','Are you sure you want to leave this room?'],'room-game':['Leave this match?','The match will continue for the other players. Are you sure you want to leave?']};
let exitReturn=null;
const AUTO_ADVANCE_OPTIONS=[0,6,10,15],DEFAULT_AUTO_ADVANCE_SECONDS=6;
let autoAdvanceTimer=null;
function clearAutoAdvance(){if(autoAdvanceTimer!==null)clearTimeout(autoAdvanceTimer);autoAdvanceTimer=null}
function askExit(onLeave){const [title,text]=EXIT_TEXT[state.view]||['Exit?','Are you sure you want to exit?'];const box=$('#exit-confirm');$('#exit-title').textContent=title;$('#exit-text').textContent=text;exitReturn=DOC.activeElement;box.hidden=false;$$('main, .topbar').forEach(el=>el.inert=true);
 const close=leave=>{box.hidden=true;$$('main, .topbar').forEach(el=>el.inert=false);$('#exit-stay').onclick=$('#exit-leave').onclick=box.onkeydown=null;if(leave)onLeave();else setTimeout(()=>exitReturn?.focus?.(),30)};
 $('#exit-stay').onclick=()=>close(false);$('#exit-leave').onclick=()=>close(true);box.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close(false)}else if(e.key==='Tab'){const a=$('#exit-stay'),b=$('#exit-leave');if(DOC.activeElement===a&&e.shiftKey||DOC.activeElement===b&&!e.shiftKey){e.preventDefault();(DOC.activeElement===a?b:a).focus()}}};
 setTimeout(()=>$('#exit-stay').focus(),30)}
const needsExitConfirm=view=>!!EXIT_TEXT[state.view]&&view!==state.view&&view!=='results'&&!(state.view==='countmatch'&&(!countMatch?.state||countMatch.state.done))&&!(state.view==='room'&&(view==='watch'||view==='room-game'||(live&&view===LIVE_VIEWS[live.kind])));
const liveScoreNow=()=>!live?0:live.kind==='quiz'?state.score:live.kind==='letters'?(lettersGame.state.score||0):live.kind==='roomplay'?(roomPlay?.score||0):Math.floor((soundMatch.state?.matched?.size||0)/2);
function liveFlush(){if(!live)return;const sc=liveScoreNow();if(sc!==liveScore){liveScore=sc;liveBuf.push({k:'score',b:String(sc)})}if(!liveBuf.length)return;const gameId=live.gameId;callApi('game-post',{gameId,events:liveBuf.splice(0,40)}).catch(err=>{if(['game_finished','game_unavailable'].includes(err.message)&&live?.gameId===gameId)stopLive(false)})}
function startLive(options){const {gameId,roomId,kind,config={}}=options;stopLive(true);lastRoom=roomId;unlockAudio();if(options.synchronized===true||(SYNC_ROOM_KINDS.has(kind)&&!['letters','soundmatch'].includes(kind))){live={gameId,roomId,kind:'roomplay'};liveBuf=[];liveScore=-1;roomPlay?.open({...options,gameId,roomId,kind,config});return}live={gameId,roomId,kind};liveBuf=[];liveScore=-1;liveTimer=setInterval(liveFlush,1200);if(kind==='quiz')startRound(CATEGORY_LIST.some(c=>c.id===config.category)?config.category:'general',modes.some(([id])=>id===config.mode)&&config.mode!=='letters'?config.mode:'classic',{roomQuiz:true});else if(kind==='letters')openLetters();else{go('soundmatch',{focus:'#sm-title'});soundMatch.selectLevel(config.level)}}
function stopLive(sendEnd){if(!live)return;clearInterval(liveTimer);const gameId=live.gameId,roomPlayMatch=live.kind==='roomplay';if(sendEnd&&!roomPlayMatch)liveBuf.push({k:'score',b:String(liveScoreNow())},{k:'end',b:''});const events=liveBuf.splice(-40);live=null;if(roomPlayMatch)roomPlay?.close();if(events.length&&(!roomPlayMatch||sendEnd))callApi('game-post',{gameId,events}).catch(()=>{})}
function go(view,opts={}){if(!opts.confirmed&&needsExitConfirm(view)){askExit(()=>go(view,{...opts,fromHistory:false,confirmed:true}));return}const {focus,fromHistory,after}=opts;if(view!==state.view)stopDeviceSpeech();if(view==='results')$('#back-to-room').hidden=!(live&&lastRoom);if(live&&view!==LIVE_VIEWS[live.kind])stopLive(live.kind!=='roomplay');if(['room','watch','room-game'].includes(state.view)&&!['room','watch','room-game','game','letters','soundmatch'].includes(view))rooms?.leaveRoom();if(state.view==='game'&&view!=='game')cancelRound();if(state.view==='soundmatch'&&view!=='soundmatch')soundMatch.stop();if(state.view==='countmatch'&&view!=='countmatch')countMatch.stop();if(state.view==='chat'&&view!=='chat')chat?.stop();if(!fromHistory&&view!==state.view)syncHistory(view);playMusic(musicFor(view,state.category,state.mode));$$('.view').forEach(v=>{v.hidden=true;v.inert=true;v.setAttribute('aria-hidden','true')});const shown=$(`#view-${view}`);shown.hidden=false;shown.inert=false;shown.removeAttribute('aria-hidden');state.view=view;adminMonitor?.onViewChange(view);accountManagement?.onViewChange(view);moderation?.onViewChange(view);WIN.scrollTo(0,0);if(view==='settings'){feedback.refresh();social?.refreshSettings()}after?.();if(focus){const el=$(focus);setTimeout(()=>el?.focus(),60)}else setTimeout(()=>{const h=$(`#view-${view} h1`);h?.setAttribute('tabindex','-1');h?.focus()},30)}
// The header line is NOT a live region: rewriting it after every answer made TalkBack read "Signed in as …" in the middle of a round.
function setText(el,text){if(el&&el.textContent!==text)el.textContent=text}
let socialFor=null,social=null,chat=null,adminMonitor=null,accountManagement=null,moderation=null;
function top(){const s=getSession(),name=s?.profile?.name;accountManagement?.onSessionChange(s);if(social&&(name||null)!==socialFor){socialFor=name||null;if(name)social.start();else social.stop()}setText($('#top-meta'),name?`${ui('signInStatus')} ${name}`:'');$('#logout-button').hidden=!s;setText($('#account-open'),name?ui('profile',name):ui('account'));renderProfile();if(state.view==='home')renderQuizSetup()}
function renderProfile(){const s=getSession(),p=s?.profile;const box=$('#profile-stats'),msg=$('#profile-message'),btn=$('#profile-auth'),out=$('#profile-logout');const change=$('#profile-change');if(!p){msg.textContent='Sign in to save your XP, coins, level, and streaks.';msg.hidden=false;box.hidden=true;btn.hidden=false;out.hidden=true;change.hidden=true;$('#profile-notice').hidden=true;return}msg.hidden=true;btn.hidden=true;out.hidden=false;box.hidden=false;change.hidden=false;const acc=p.questionsAnswered?Math.round(p.questionsCorrect/p.questionsAnswered*100):0;box.innerHTML='';for(const [k,v] of profileRows(p,acc)){const li=DOC.createElement('li');const a=DOC.createElement('span');a.className='stat-label';a.textContent=`${k}, `;const b=DOC.createElement('span');b.className='stat-value';if(k==='User ID')b.append(spokenId(String(v)));else b.textContent=String(v??0);li.append(a,b);box.append(li)}}
// Shows the Login ID as printed (ABCD2345) but lets screen readers spell it (A B C D 2 3 4 5).
function spokenId(id){const f=DOC.createDocumentFragment();const shown=DOC.createElement('span');shown.setAttribute('aria-hidden','true');shown.textContent=id;const spoken=DOC.createElement('span');spoken.className='sr-only';spoken.textContent=id.split('').join(' ');f.append(shown,spoken);return f}
// Each row is one sentence for TalkBack ("Level, 1"); no definition-list roles are exposed.
function profileRows(p,acc){const rows=[['Player',p.name]];const id=p.loginId||getSession()?.loginId;if(id)rows.push(['User ID',id]);rows.push(['Level',p.level],['XP',p.xp],['Coins',p.coins],['Current streak',p.currentStreak],['Best streak',p.bestStreak],['Questions answered',p.questionsAnswered],['Correct answers',`${p.questionsCorrect}, ${acc} percent`]);return rows}
// Decorative only (aria-hidden): sighted players get an icon and colour per category.
const CATEGORY_ICON={animals:'🐘',birds:'🐦',nature:'🌿',instruments:'🎻',science:'🔬',geography:'🗺️',india:'🪷',history:'🏛️',technology:'💻',sports:'⚽',civics:'⚖️',economics:'📈',music:'🎵',abbreviations:'🔤',vocabulary:'📖',braille:'⠿',management:'📋',business:'💼',accounting:'🧮',commerce:'🛒',medical:'🩺',math:'➗',physics:'⚛️',chemistry:'⚗️',biology:'🧬',mathematics:'➗',health:'🩺',literature:'📚',food:'🍎',arts:'🎨'};
const CATEGORY_HUE={animals:30,birds:195,nature:120,instruments:20,science:265,geography:170,india:35,history:40,technology:210,sports:140,civics:230,economics:150,music:300,abbreviations:55,vocabulary:280,braille:75,management:185,business:220,accounting:160,commerce:15,medical:355,math:250,physics:200,chemistry:95,biology:130,mathematics:245,health:345,literature:315,food:45,arts:325};
function playableBank(){return localizedBank(QUESTION_BANK,state.settings.language)}
function progressionStorageKey(){const session=getSession(),loginId=session?.loginId||session?.profile?.loginId;return `bq.quizProgress.v1.${loginId||'guest'}`}
function unlockedStage(){try{return normalizedUnlockedStage(localStorage.getItem(progressionStorageKey()))}catch{return 1}}
function saveUnlockedStage(value){try{localStorage.setItem(progressionStorageKey(),String(normalizedUnlockedStage(value)))}catch{}}
function renderQuizSetup(){
 const language=$('#language-choice'),stageSelect=$('#quiz-stage'),difficulty=$('#quiz-difficulty'),roundLength=$('#quiz-round-length');if(!language||!stageSelect||!difficulty||!roundLength)return;
 language.value=state.settings.language==='te'?'te':'en';
 const bank=playableBank(),unlocked=unlockedStage(),selectedStage=Number(state.settings.quizStage)||0;
 const customOption=DOC.createElement('option');customOption.value='';customOption.textContent=ui('custom');stageSelect.replaceChildren(customOption);
 for(const stage of QUIZ_STAGES){
  const count=bank.filter(q=>questionMatchesDifficulty(q,stage.difficulty)).length;
  const blocked=stage.id>unlocked||count===0;
  const title=stageLabel(state.settings.language,stage.id-1),level=ui(stage.difficulty);
  const suffix=blocked?` — ${ui('locked')}`:'';
  const option=DOC.createElement('option');option.value=String(stage.id);option.textContent=`${ui('stageWord')} ${stage.id}: ${title} — ${level}, ${stage.roundLength} ${state.settings.language==='te'?'ప్రశ్నలు':'questions'}${suffix}`;option.disabled=blocked;stageSelect.append(option);
 }
 difficulty.value=['all','easy','medium','hard','expert'].includes(state.settings.quizDifficulty)?state.settings.quizDifficulty:'all';
 roundLength.value=['5','10','15'].includes(String(state.settings.quizRoundLength))?String(state.settings.quizRoundLength):'10';
 stageSelect.value=selectedStage&&selectedStage<=unlocked?String(selectedStage):'';
 const status=$('#quiz-stage-status');
 if(selectedStage&&selectedStage<=unlocked){const stage=QUIZ_STAGES[selectedStage-1];status.textContent=ui('stageReady',stage.id,stageLabel(state.settings.language,stage.id-1),ui(stage.difficulty),stage.roundLength)}
 else status.textContent=ui('stageCustom');
 const total=$('#total-categories');if(total){const available=new Set(bank.map(q=>q.category));total.textContent=String(state.settings.language==='te'?available.size:CATEGORY_LIST.length)}
 const note=$('#telugu-content-note');if(note){note.hidden=state.settings.language!=='te';note.textContent=ui('teluguNote',bank.length)}
 const languageNote=$('#language-note');if(languageNote){languageNote.hidden=state.settings.language!=='te';languageNote.textContent=ui('moreTelugu')}
}
function persistQuizSettings(){try{localStorage.setItem('bq.settings',JSON.stringify(state.settings))}catch{}}
function selectQuizStage(value){const id=Number(value)||0;if(!id){state.settings.quizStage=0;persistQuizSettings();renderQuizSetup();announce(ui('stageCustom'));return}const stage=QUIZ_STAGES[id-1];if(!stage||id>unlockedStage())return;state.settings.quizStage=id;state.settings.quizDifficulty=stage.difficulty;state.settings.quizRoundLength=stage.roundLength;persistQuizSettings();renderQuizSetup();announce(ui('stageReady',stage.id,stageLabel(state.settings.language,stage.id-1),ui(stage.difficulty),stage.roundLength))}
function selectCustomQuizSetting(){state.settings.quizStage=0;state.settings.quizDifficulty=$('#quiz-difficulty').value;state.settings.quizRoundLength=Number($('#quiz-round-length').value);persistQuizSettings();renderQuizSetup();announce(ui('stageCustom'))}
function renderCategories(){const host=$('#category-list');host.replaceChildren();const bank=playableBank(),available=new Set(bank.map(q=>q.category));const categories=state.settings.language==='te'?CATEGORY_LIST.filter(c=>available.has(c.id)):CATEGORY_LIST;for(const c of categories){const b=DOC.createElement('button');b.type='button';b.className='category-button';b.dataset.category=c.id;b.style.setProperty('--hue',String(CATEGORY_HUE[c.id]??200));const name=categoryLabel(state.settings.language,c);b.innerHTML=`<span class="category-icon" aria-hidden="true">${CATEGORY_ICON[c.id]||'❓'}</span><strong>${esc(name)}</strong><small class="category-desc">${esc(categoryDescription(state.settings.language,c))}</small>`;host.append(b)}}
function renderTotals(){const n=$('#total-categories');if(n)n.textContent=String(state.settings.language==='te'?new Set(playableBank().map(q=>q.category)).size:CATEGORY_LIST.length)}
function renderModes(){const host=$('#mode-list');host.replaceChildren();const bank=playableBank();for(const [id,name,desc] of modes){const [label,description]=modeLabel(state.settings.language,id,name,desc);const b=DOC.createElement('button');b.type='button';b.className='mode-button';b.dataset.mode=id;const unavailable=state.settings.language==='te'&&(id==='letters'||!poolForQuestions(bank,'general',id).length);b.disabled=unavailable;b.innerHTML=`<strong>${esc(label)}</strong><small>${esc(unavailable?ui('notAvailable'):description)}</small>`;b.setAttribute('aria-label',`${label} mode. ${unavailable?ui('notAvailable'):description}`);host.append(b)}}
function esc(v){return String(v).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))}
function applyLanguage(){
 const lang=state.settings.language==='te'?'te':'en';DOC.documentElement.lang=lang==='te'?'te-IN':'en';
 $('#home-eyebrow').textContent=ui('homeEyebrow');$('#home-title').innerHTML=lang==='te'?'వినండి.<br><em>తాకండి. గెలవండి.</em>':'Hear it.<br><em>Tap it. Win it.</em>';
 $('#home-lead').textContent=ui('homeLead');$('#play-featured').textContent=`${ui('playNow')} →`;
 $('#settings-open').textContent=ui('settings');$('#settings-open').setAttribute('aria-label',ui('settingsAria'));
 $('#voice-instructions').textContent=ui('voiceButton');$('#game-signals').setAttribute('aria-label',ui('gameStatus'));
 $('#category-count-label').textContent=ui('categoryUnit');$('#difficulty-count-label').textContent=ui('difficultyCount');$('#audio-first-label').textContent=ui('audioFirst');$('#play-label').textContent=ui('playWord');$('#input-method-label').textContent=ui('inputMethods');
 $('#categories-eyebrow').textContent=ui('chooseWorld');$('#categories-title').textContent=ui('categories');$('#random-category').textContent=`${ui('random')} ↗`;
 $('#modes-eyebrow').textContent=ui('chooseChallenge');$('#modes-title').textContent=ui('modes');
 $('#quiz-setup-eyebrow').textContent=ui('setupEyebrow');$('#quiz-setup-title').textContent=ui('setupTitle');
 $('#language-choice-label').textContent=ui('language');$('#quiz-stage-label').textContent=ui('stage');$('#quiz-difficulty-label').textContent=ui('difficulty');$('#quiz-round-length-label').textContent=ui('roundLength');
 const difficultyLabels={all:ui('mixed'),easy:ui('easy'),medium:ui('medium'),hard:ui('hard'),expert:ui('expert')};$$('#quiz-difficulty option').forEach(option=>option.textContent=difficultyLabels[option.value]||option.textContent);
 const lengthLabels={'5':ui('fiveQuestions'),'10':ui('tenQuestions'),'15':ui('fifteenQuestions')};$$('#quiz-round-length option').forEach(option=>option.textContent=lengthLabels[option.value]||option.textContent);
 $('#repeat-question').textContent=ui('repeat');$('#read-status').textContent=ui('roundStatus');
 const loginLabel=$('#remember-session-copy'),loginNote=$('#remember-session-note');if(loginLabel)loginLabel.textContent=lang==='te'?'ఈ పరికరంలో సైన్ ఇన్‌లో ఉండండి':'Stay signed in on this device';if(loginNote)loginNote.textContent=lang==='te'?'ఐచ్ఛికం. మీకు నమ్మకమైన పరికరంలో మాత్రమే ఎంచుకోండి. ఎంచుకుంటే, మీరు లాగ్ అవుట్ చేసే వరకు ఈ పరికరం సైన్ ఇన్‌లో ఉంటుంది; లేకపోతే ఈ ట్యాబ్ లేదా యాప్ సెషన్ వరకే.':'Optional. Choose this only on a device you trust. If selected, this device stays signed in until you log out; otherwise, sign-in lasts only for this tab or app session.';
 $('#letters-callout').hidden=lang==='te';renderCategories();renderTotals();renderModes();renderQuizSetup();top();
}
function speakInstructions(){if(!talkBackEnabled)return;const text=instructionText(state.settings.language);if(!speakText(text))announceAccessibility(text)}
function setAuthTab(tab){$$('[data-auth-tab]').forEach(b=>{const on=b.dataset.authTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});$('#login-form').hidden=tab!=='login';$('#signup-form').hidden=tab!=='signup';$('#recovery-form').hidden=true;$('#signup-success').hidden=true;$('#auth-title').textContent=tab==='login'?'Log in to play':'Create your account';{const intro=$('#auth-intro');if(intro)intro.textContent=tab==='login'?'Log in with your name, Login ID and secret answer.':'Create an account with your name, a secret question and a secret answer.'}if(tab==='login'){applyRemembered();$(loginFocus()).focus()}else{if(!$('#signup-name').value.trim())generateSignupName();$('#signup-name').focus()}}
function showError(id,msg){const e=$(id);e.textContent=msg;e.hidden=false;announce(msg,true)}
// One-tap sign in: only Name and Login ID are remembered on this device. The secret answer is never stored.
const REMEMBER_KEY='blindquiz.remembered.v1';
function getRemembered(){try{const r=JSON.parse(localStorage.getItem(REMEMBER_KEY)||'null');return r&&typeof r.name==='string'&&/^[A-Z0-9]{8}$/.test(r.loginId||'')?{name:r.name,loginId:r.loginId}:null}catch{return null}}
function rememberDevice(name,loginId){try{localStorage.setItem(REMEMBER_KEY,JSON.stringify({name,loginId}))}catch{}}
function forgetDevice(){try{localStorage.removeItem(REMEMBER_KEY)}catch{}}
function applyRemembered(){const r=getRemembered(),box=$('#remembered-device');if(!r){box.hidden=true;return false}const typed=$('#login-name').value.trim();if(typed&&typed!==r.name){box.hidden=true;return false}$('#login-name').value=r.name;$('#login-id').value=r.loginId;$('#remembered-copy').textContent=`Welcome back, ${r.name}. Your name and Login ID are filled in from this device. Just type your secret answer.`;box.hidden=false;lookupQuestion();announce(`Welcome back, ${r.name}. Your name and Login ID ${r.loginId.split('').join(' ')} are already filled in. Type your secret answer to sign in.`);return true}
const loginFocus=()=>getRemembered()?'#login-answer':'#login-name';
const SIGNUP_ADJECTIVES=['Bright','Brave','Curious','Gentle','Jolly','Kind','Merry','Mighty','Patient','Playful','Quick','Quiet','Sunny','Wise','Witty','Zesty','Clever','Daring','Friendly','Lucky'];
const SIGNUP_NOUNS=['Badger','Bluebird','Comet','Dolphin','Dragonfly','Falcon','Firefly','Fox','Heron','Hummingbird','Jaguar','Kestrel','Koala','Lynx','Otter','Panda','Phoenix','Robin','Tiger','Turtle'];
let signupNameSuggestionSequence=0,applyingSignupNameSuggestion=false;
function localSignupName(){const number=max=>globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(new Uint32Array(1))[0]%max:Math.floor(Math.random()*max),pick=list=>list[number(list.length)];return `${pick(SIGNUP_ADJECTIVES)} ${pick(SIGNUP_NOUNS)} ${10+number(90)}`}
function writeSignupName(name){const input=$('#signup-name');applyingSignupNameSuggestion=true;try{input.value=name;input.dispatchEvent(new Event('input',{bubbles:true}))}finally{applyingSignupNameSuggestion=false}}
async function generateSignupName(){const sequence=++signupNameSuggestionSequence;writeSignupName(localSignupName());try{const data=await callApi('suggest-name');if(sequence!==signupNameSuggestionSequence)return;const name=typeof data.name==='string'?data.name.trim():'';if(name.length<2||name.length>40||Array.from(name).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return;writeSignupName(name)}catch{}}
const genericLogin='The name, Login ID, or secret answer is incorrect. Please try again.',genericFailure='Something went wrong. Please try again later.';
let questionLookupTimer,signupNameTimer;
async function checkSignupName(){const name=$('#signup-name').value.trim(),status=$('#signup-name-status');status.textContent='';if(name.length<2)return;try{const data=await callApi('check-name',{name});if($('#signup-name').value.trim()!==name)return;status.textContent=data.available?'Name is available.':'This name is already registered. Please choose another name.';if(!data.available)announce(status.textContent,true)}catch{if($('#signup-name').value.trim()===name)status.textContent='Name availability will be checked when you create the account.'}}
async function lookupQuestion(){const name=$('#login-name').value.trim(),loginId=$('#login-id').value.trim().toUpperCase();if(name.length<2||loginId.length!==8)return;try{const d=await callApi('secret-question',{name,loginId});$('#question-context').textContent=d.question||'Secret question';$('#question-context').hidden=false}catch{$('#question-context').hidden=true}}
async function signUp(e){e.preventDefault();signupNameSuggestionSequence++;$('#signup-error').hidden=true;const name=$('#signup-name').value.trim(),selection=$('#secret-question').value,question=selection==='custom'?$('#custom-question').value.trim():selection,answer=$('#signup-answer').value.trim(),btn=$('#signup-form button[type=submit]');if(name.length<2||!question||answer.length<2){showError('#signup-error','Please complete each field with at least two characters.');return}btn.disabled=true;btn.textContent='Creating account…';announce('Creating account. Please wait.');try{const data=await callApi('signup',{name,question,answer});$('#signup-success').hidden=false;$('#new-login-id').textContent=data.loginId;$('#signup-form').hidden=true;$('#login-form').hidden=true;$('#auth-title').textContent='Account created';$('#copy-login-id').focus();announce(`Your account has been created successfully. Your Login ID is ${data.loginId}.`,true)}catch(err){const message=err.message==='name_taken'?'This name is already registered. Please choose another name.':err.message==='rate_limited'?'Too many attempts. Please wait and try again.':'Something went wrong. Please try again.';showError('#signup-error',message)}finally{btn.disabled=false;btn.innerHTML='Create account <span aria-hidden="true">→</span>'}}
async function login(e){e.preventDefault();$('#login-error').hidden=true;const name=$('#login-name').value.trim(),loginId=$('#login-id').value.trim().toUpperCase(),answer=$('#login-answer').value.trim(),btn=$('#login-form button[type=submit]');if(!name||loginId.length!==8||!answer){showError('#login-error','Enter your name, 8-character Login ID, and secret answer.');return}btn.disabled=true;announce('Signing in. Please wait.');try{const d=await callApi('login',{name,loginId,answer});setSession({token:d.token,expiresAt:d.expiresAt,profile:d.profile,loginId},{remember:$('#remember-session').checked});rememberDevice(d.profile?.name||name,loginId);$('#login-answer').value='';state.profile=d.profile;top();if(d.firstLogin){$('#welcome-title').textContent=`Welcome to Blind Quiz, ${d.profile.name}.` ;$('#welcome-copy').textContent='Your quiz journey begins now.';go('welcome',{focus:'#welcome-continue'});announce(`Login successful. Welcome to Blind Quiz, ${d.profile.name}. Your quiz journey begins now.`)}else{go('home',{focus:'#play-featured'});announce(`Login successful. Welcome, ${d.profile.name}.`)}}catch(err){showError('#login-error',err.message==='rate_limited'?'Too many attempts. Please wait and try again.':err.message==='invalid_credentials'?genericLogin:err.message==='account_restricted'?'This account is restricted after admin review. Contact the Blind Quiz administrator if you think this is a mistake.':genericFailure)}finally{btn.disabled=false}}
async function recoverLoginId(e){e.preventDefault();$('#recovery-error').hidden=true;const name=$('#recovery-name').value.trim(),sel=$('#recovery-question').value,question=sel==='custom'?$('#recovery-custom-question').value.trim():sel,answer=$('#recovery-answer').value.trim();if(!name||!question||!answer){showError('#recovery-error','Complete each recovery field.');return}const btn=$('#recovery-form button[type=submit]');btn.disabled=true;try{const d=await callApi('recover-id',{name,question,answer});$('#recovered-id').textContent=d.loginId;$('#recovery-result').hidden=false;$('#copy-recovered-id').focus();const msg=`Your Login ID is ${d.loginId}.`;speakText(msg);announce(msg,true)}catch(err){showError('#recovery-error',err.message==='rate_limited'?'Too many attempts. Please wait and try again.':err.message==='invalid_recovery'?'The recovery details are incorrect. Please check them and try again.':genericFailure)}finally{btn.disabled=false}}
let recoveryMode='id',recoveryQuestionLookupTimer;
function selectMatchingQuestion(selectEl,customWrapEl,customInputEl,questionText){if(!selectEl||!questionText)return;const opts=[...selectEl.options].map(o=>o.value||o.textContent);if(opts.includes(questionText)){selectEl.value=questionText;if(customWrapEl)customWrapEl.hidden=true}else{selectEl.value='custom';if(customWrapEl)customWrapEl.hidden=false;if(customInputEl)customInputEl.value=questionText}}
async function lookupRecoveryQuestion(){const name=$('#recover-answer-name')?.value.trim()||'',loginId=($('#recover-answer-login-id')?.value.trim()||'').toUpperCase(),ctx=$('#recover-answer-question-context');if(!ctx)return;if(name.length<2||loginId.length!==8){ctx.hidden=true;return}try{const d=await callApi('secret-question',{name,loginId});if(d?.question){ctx.textContent=`Secret question: ${d.question}`;ctx.hidden=false;selectMatchingQuestion($('#recover-answer-question'),$('#recover-answer-custom-wrap'),$('#recover-answer-custom-question'),d.question)}}catch{ctx.hidden=true}}
function setRecoveryMode(mode,{speakChoice=true}={}){recoveryMode=mode==='answer'?'answer':'id';$$('[data-recover-mode]').forEach(b=>{const on=b.dataset.recoverMode===recoveryMode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});const idPane=$('#recovery-id-pane'),ansPane=$('#recovery-answer-pane');if(idPane)idPane.hidden=recoveryMode!=='id';if(ansPane)ansPane.hidden=recoveryMode!=='answer';$('#auth-title').textContent=recoveryMode==='answer'?'Recover your secret answer':'Recover your Login ID';if(recoveryMode==='answer'){$('#recover-answer-error').hidden=true;$('#recovery-answer-result').hidden=true;const rem=getRemembered(),typedName=$('#login-name')?.value.trim()||rem?.name||'',typedId=($('#login-id')?.value.trim()||rem?.loginId||'').toUpperCase();if(typedName&&!$('#recover-answer-name').value.trim())$('#recover-answer-name').value=typedName;if(typedId&&!$('#recover-answer-login-id').value.trim())$('#recover-answer-login-id').value=typedId;lookupRecoveryQuestion();const focusTarget=$('#recover-answer-name').value.trim()&&$('#recover-answer-login-id').value.trim().length===8?'#recover-new-answer':'#recover-answer-name';$(focusTarget)?.focus();if(speakChoice){const msg='Recover your secret answer. Verify your name, eight-character Login ID, and secret question to set a new secret answer.';speakText(msg);announce(msg,true)}}else{$('#recovery-error').hidden=true;$('#recovery-result').hidden=true;$('#recovery-name')?.focus();if(speakChoice){const msg='Recover your Login ID. Verify the name, secret question, and secret answer you registered with.';speakText(msg);announce(msg,true)}}}
async function recoverSecretAnswer(e){if(e)e.preventDefault();$('#recover-answer-error').hidden=true;const name=$('#recover-answer-name').value.trim(),loginId=$('#recover-answer-login-id').value.trim().toUpperCase(),sel=$('#recover-answer-question').value,question=sel==='custom'?$('#recover-answer-custom-question').value.trim():sel,answer=$('#recover-new-answer').value.trim();if(name.length<2||loginId.length!==8||question.length<8||answer.length<2){showError('#recover-answer-error','Complete your name, 8-character Login ID, secret question, and new secret answer.');return}const btn=$('#recover-answer-submit');btn.disabled=true;try{await callApi('recover-answer',{name,loginId,question,answer});$('#recover-new-answer').value='';$('#recovery-answer-result').hidden=false;$('#login-name').value=name;$('#login-id').value=loginId;$('#recover-answer-continue').focus();const msg='Your secret answer has been updated. You can now log in with your new secret answer.';speakText(msg);announce(msg,true)}catch(err){showError('#recover-answer-error',err.message==='rate_limited'?'Too many attempts. Please wait and try again.':err.message==='invalid_recovery'?'The recovery details are incorrect. Please check your name, Login ID, and secret question.':err.message==='account_restricted'?'This account is restricted after admin review.':genericFailure)}finally{btn.disabled=false}}
function transformQuestion(q){return presentQuestion(q,state.mode,shuffled)}
function resetStage(){const stage=$('#game-stage');stage.querySelectorAll('.answer-list,.feedback,.next-question').forEach(el=>el.remove());if(!$('#game-copy')){const p=DOC.createElement('p');p.className='game-copy';p.id='game-copy';$('#game-title').after(p)}$('#game-title').className='';const ht=$('#hud-timer');if(ht)ht.hidden=true;const hs=$('#hud-score');if(hs)hs.textContent='★ 0';}
function cancelRound(){state.roundId++;clearTimer();clearAutoAdvance();state.locked=false}
function startRound(category='general',mode='classic',options={}){
 // A second activation of the same control while this round is still opening is ignored.
 const roundKey=`${category}:${mode}`;
 if(openingRoundFor===roundKey)return;
 openingRoundFor=roundKey;
 setTimeout(()=>{if(openingRoundFor===roundKey)openingRoundFor=''},0);
 cancelRound();resetStage();state.category=category;state.mode=mode;
 const roomQuiz=options.roomQuiz===true,language=roomQuiz?'en':state.settings.language,bank=roomQuiz?QUESTION_BANK:playableBank(),difficulty=roomQuiz?'all':state.settings.quizDifficulty,roundLength=roomQuiz?null:state.settings.quizRoundLength;state.roundLanguage=language;
 const pool=poolForQuestions(bank,category,mode).filter(q=>questionMatchesDifficulty(q,difficulty));
 if(!pool.length){announce(ui('noQuestions'),true);return}
 const selected=selectRoundQuestions(bank,category,mode,shuffled,{difficulty,roundLength});
 if(!selected.length){announce(ui('noQuestions'),true);return}
 state.activeStageId=roomQuiz?0:Number(state.settings.quizStage)||0;state.difficulty=difficulty;
 state.questions=selected.map(transformQuestion);state.index=0;state.score=0;state.streak=0;state.roundXp=0;state.roundCoins=0;state.levelUps=[];state.answered=false;state.answeredCount=0;state.lastAnswerCorrect=null;state.roundTimer=timeLimitFor(mode,state.settings.timer);
 const n=state.questions.length,stage=state.activeStageId?QUIZ_STAGES[state.activeStageId-1]:null,modeName=modeLabel(language,mode,modes.find(m=>m[0]===mode)?.[1]||mode,'')[0],categoryName=categoryLabel(language,CATEGORY_LIST.find(c=>c.id===category)||{id:'',name:'Mixed'}),countLabel=language==='te'?`${n} ప్రశ్నలు`:`${n} questions`,challenge=stage?`${uiText(language,'stageWord')} ${stage.id} · ${stageLabel(language,stage.id-1)} · ${uiText(language,stage.difficulty)} · ${countLabel}`:`${uiText(language,difficulty==='all'?'mixed':difficulty)} · ${countLabel}`;
 $('#round-label').textContent=`${challenge.toUpperCase()} · ${modeName.toUpperCase()} · ${categoryName.toUpperCase()}`;$('#game-start').disabled=false;$('#game-start').hidden=false;$('#game-start').textContent=uiText(language,'playQuiz');$('#game-tools').hidden=true;$('#round-progress').textContent=language==='te'?`${n} ప్రశ్నలు`:`${n} questions`;
 $('#progress-meter').style.width='0%';$('#phase-label').textContent=language==='te'?'మీరు సిద్ధమైనప్పుడు ప్రారంభించండి':'READY WHEN YOU ARE';$('#game-title').textContent=language==='te'?'కొత్త ప్రశ్నకు సిద్ధంగా ఉండండి.':'Make some room for a new question.';$('#game-copy').textContent=language==='te'?'మీరు ప్రారంభించినప్పుడు చిన్న కౌంట్‌డౌన్ తర్వాత మొదటి ప్రశ్న వస్తుంది.':'When you start, listen for the countdown. The first question begins after GO.';go('game',{focus:'#game-start'});announceAccessibility(instructionText(language));playMusic(musicFor('game',category,mode));
 // One double tap on a category is enough: the round starts by itself and the countdown is the
 // 'get ready' signal. The countdown can only run once per round.
if(state.settings.autoStart!==false)countdownAndBegin()
}
async function countdownAndBegin(){if(state.locked)return;unlockAudio();state.locked=true;const id=state.roundId,alive=()=>id===state.roundId&&state.view==='game';try{const b=$('#game-start');b.disabled=true;b.textContent=ui('starting');$('#phase-label').textContent=state.roundLanguage==='te'?'సిద్ధంగా ఉండండి':'GET READY';$('#game-title').textContent=ui('getReady');$('#game-copy').textContent=ui('getReadyCopy');announce(ui('getReady'));await sleep(1050);if(!alive())return;$('#game-title').className='countdown-num';for(const n of ['3','2','1']){$('#game-title').textContent=n;$('#game-title').classList.remove('pop');void $('#game-title').offsetWidth;$('#game-title').classList.add('pop');$('#game-copy').textContent='';playSfx('tick');announce(n,true);await sleep(1120);if(!alive())return}$('#game-title').textContent=ui('go');playSfx('go');announce(ui('go'),true);await sleep(950);if(!alive())return;$('#game-tools').hidden=false;showQuestion()}finally{if(id===state.roundId)state.locked=false}}
function showQuestion(){clearTimer();clearAutoAdvance();const q=state.questions[state.index];if(!q){finishRound();return}state.answered=false;const progress=ui('question',state.index+1,state.questions.length);livePush('say',`${progress}. ${q.displayQuestion} ${ui('options')}: ${q.displayAnswers.map((a,i)=>`${LETTERS[i]}, ${a}`).join('. ')}.`);const category=CATEGORY_LIST.find(c=>c.id===q.category);$('#phase-label').textContent=`${categoryLabel(state.roundLanguage,category||{id:'',name:q.category})} · ${ui(state.difficulty==='all'?q.difficulty:state.difficulty)}`;$('#round-progress').textContent=progress;$('#progress-meter').style.width=`${state.index/state.questions.length*100}%`;$('#game-title').textContent=`${progress}. ${q.displayQuestion}`;$('#game-title').className='question-text';$('#game-title').setAttribute('tabindex','-1');const stage=$('#game-stage');stage.querySelector('.game-copy')?.remove();stage.querySelector('.answer-list')?.remove();stage.querySelector('.choice-nav')?.remove();stage.querySelector('.gesture-hint')?.remove();stage.querySelector('.feedback')?.remove();stage.querySelector('.next-question')?.remove();const list=DOC.createElement('div');list.className='answer-list';list.setAttribute('role','group');list.setAttribute('aria-label',ui('answerChoices'));q.displayAnswers.forEach((answer,i)=>{const btn=DOC.createElement('button');btn.type='button';btn.className='answer-button';btn.dataset.index=String(i);btn.dataset.answer=answer;btn.dataset.letter=LETTERS[i];const badge=DOC.createElement('span');badge.className='answer-letter';badge.setAttribute('aria-hidden','true');badge.textContent=LETTERS[i];const text=DOC.createElement('span');text.className='answer-text';text.textContent=answer;btn.append(badge,text);btn.setAttribute('aria-label',ui('option',LETTERS[i],answer));btn.addEventListener('click',()=>chooseAnswer(answer,btn));list.append(btn)});stage.append(list);const nav=DOC.createElement('div');nav.className='choice-nav';nav.setAttribute('role','group');nav.setAttribute('aria-label',ui('moveBetweenChoices'));for(const [dir,label] of [['back',ui('previousChoice')],['forward',ui('nextChoice')]]){const b=DOC.createElement('button');b.type='button';b.className='button choice-nav-button';b.dataset.move=dir;b.textContent=label;b.setAttribute('aria-label',label);nav.append(b)}stage.append(nav);const hint=DOC.createElement('p');hint.className='gesture-hint';hint.id='gesture-hint';hint.textContent=gestureHintText();stage.append(hint);const fb=DOC.createElement('div');fb.className='feedback';fb.id='answer-feedback';fb.tabIndex=-1;stage.append(fb);$('#game-start').hidden=true;$('#round-progress').textContent=progress;$('#game-title').focus();const spokenChoices=`${ui('answerChoices')}: ${q.displayAnswers.map((answer,i)=>ui('option',LETTERS[i],answer).replace(/[.]+$/,'')).join('. ')}.`;announceAccessibility(spokenChoices);updateHud();startTimer();}
function updateHud(){const s=$('#hud-score');if(s)s.textContent=`★ ${state.score}`;const t=$('#hud-timer');const seconds=Number(state.roundTimer??state.settings.timer);if(t){t.hidden=!seconds||state.view!=='game';if(seconds){const left=Math.max(0,state.timeLeft);t.style.setProperty('--left',String(left/seconds));t.classList.toggle('low',left<=5);$('#hud-seconds').textContent=`${left}s`}}}
function startTimer(){const seconds=Number(state.roundTimer??state.settings.timer);if(!seconds){updateHud();return}state.timeLeft=seconds;updateHud();if(seconds<=15)playSfx('tick');const warnAt=[10,5,3,2,1];state.timer=setInterval(()=>{state.timeLeft--;updateHud();if(state.timeLeft>0&&state.timeLeft<=15)playSfx('tick');if(state.timeLeft===5)playSfx('hurry');if(state.timeLeft>0&&state.timeLeft<=4)playSfx('tick_last');if(warnAt.includes(state.timeLeft))announce(ui('timer',state.timeLeft));if(state.timeLeft<=0){clearTimer();timeExpired()}},1000)}function clearTimer(){if(state.timer)clearInterval(state.timer);state.timer=null}
function offerNextQuestion(){const next=DOC.createElement('button');next.type='button';next.className='button button-hot next-question';next.textContent=state.index+1>=state.questions.length||endsAfterMiss(state.mode,state.lastAnswerCorrect)?ui('viewResults'):ui('answerAgain');next.addEventListener('click',advance,{once:true});$('#game-stage').append(next)}
const withTimeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),ms))]);
// Answer buttons are locked with aria-disabled (not the disabled attribute), so the focused button keeps
// focus until the result is ready; then focus moves deliberately to the result, followed by the Next button.
function lockAnswers(q,chosen,correct){$$('.answer-button').forEach(b=>{b.setAttribute('aria-disabled','true');b.classList.add('locked');const base=ui('optionResult',b.dataset.letter,b.dataset.answer);if(b.dataset.answer===q.displayCorrect){b.classList.add('correct');b.setAttribute('aria-label',`${base}, ${ui('correctLabel')}${b===chosen?`, ${ui('yourAnswer')}`:''}`)}else if(b===chosen){b.classList.add('incorrect');b.setAttribute('aria-label',`${base}, ${ui('yourAnswer')}, ${ui('incorrectLabel')}`)}})}
function showResult(text,kind){const fb=$('#answer-feedback');if(!fb)return;const delay=Number(state.settings.autoAdvanceSeconds)||0,finalStep=endsAfterMiss(state.mode,state.lastAnswerCorrect)||state.index+1>=state.questions.length;fb.textContent=delay?`${text} ${ui('autoAdvance',delay,ui(finalStep?'viewResults':'answerAgain'),finalStep)}`:text;if(kind)fb.dataset.kind=kind;updateHud();offerNextQuestion();clearAutoAdvance();setTimeout(()=>{if(state.view==='game'&&DOC.body.contains(fb))fb.focus()},40);if(delay)autoAdvanceTimer=setTimeout(()=>{autoAdvanceTimer=null;if(state.view==='game'&&state.answered)advance()},delay*1000)}
async function chooseAnswer(answer,button){
 if(state.answered||button.getAttribute('aria-disabled')==='true')return;
 state.answered=true;clearTimer();const round=state.roundId,q=state.questions[state.index],correct=answer===q.displayCorrect;
 state.lastAnswerCorrect=correct;state.answeredCount++;playSfx(correct?'correct':'wrong');if(correct)state.score++;state.streak=correct?(state.streak||0)+1:0;
 lockAnswers(q,button,correct);const fb=$('#answer-feedback');fb.dataset.kind=correct?'good':'bad';updateHud();fb.textContent=correct?ui('correct'):ui('incorrect',optionName(q,q.displayCorrect));livePush('say',`${answer}. ${fb.textContent}`);
 let verdict=correct,reward='',streakText='';const session=getSession();
 if(session&&q.displayAnswers.length===4){try{
  const prevLevel=session.profile?.level,choice=q.recordChoiceByDisplay?.[answer]??answer;
  const saved=await withTimeout(callApi('record-answer',{questionId:q.id,choice}),6000);
  state.profile=saved.profile;setSession({...getSession(),profile:saved.profile});top();
  const serverVerdict=typeof saved.correct==='boolean'?saved.correct:correct;
  if(serverVerdict!==correct){state.score+=serverVerdict?1:-1;state.streak=serverVerdict?(Number(saved.profile?.currentStreak)||1):0}
  state.lastAnswerCorrect=serverVerdict;verdict=serverVerdict;
  if(saved.alreadyAnswered)reward=ui('alreadyRewarded');
  else if(saved.xp){reward=ui('xpCoins',saved.xp,saved.coins);state.roundXp+=saved.xp;state.roundCoins+=saved.coins||0}
  const up=levelUpLine(prevLevel,saved.profile?.level);if(up){reward+=` ${up}`;state.levelUps.push(saved.profile.level)}
  if(saved.xp)playSequence(up?['coin','levelup']:['coin']);const n=saved.profile?.currentStreak;if(verdict&&Number(n)===3)playSfx('streak');streakText=verdict?ui('streak',n):ui('streakReset');
 }catch{if(!getSession()){state.profile=null;top();reward=ui('sessionEnded')}else reward=ui('saveOffline')}}
 else{streakText=correct?ui('streak',state.streak):ui('streakReset');if(!session&&state.index===0)reward=ui('earnLogin')}
 if(round!==state.roundId||state.view!=='game')return;
 const head=verdict?ui('correct'):ui('incorrectTitle');
 const answerLine=verdict?ui('correctAnswer',optionName(q,q.displayCorrect)):ui('yourChoice',optionName(q,answer),optionName(q,q.displayCorrect));
 showResult([head,answerLine,reward,streakText,q.displayExplain].filter(Boolean).join(' '),verdict?'good':'bad')
}
function timeExpired(){if(state.answered||state.view!=='game')return;state.answered=true;state.lastAnswerCorrect=false;state.answeredCount++;state.streak=0;playSfx('timeup');const q=state.questions[state.index];lockAnswers(q,null,false);const text=state.roundLanguage==='te'?`సమయం అయింది. ${ui('correctAnswer',optionName(q,q.displayCorrect))} ${ui('streakReset')} ${q.displayExplain}`:`Time's up. ${ui('correctAnswer',optionName(q,q.displayCorrect))} ${ui('streakReset')} ${q.displayExplain}`;showResult(text,'bad')}
function advance(){if(state.view!=='game')return;clearAutoAdvance();if(endsAfterMiss(state.mode,state.lastAnswerCorrect)||state.index+1>=state.questions.length){finishRound();return}state.index++;showQuestion()}
// The profile level is 1 + XP/100 on the server, so it rises automatically; the player hears a bugle call and the announcement.
function levelUpLine(before,after){return before&&after&&after>before?(state.roundLanguage==='te'?`స్థాయి పెరిగింది! ఇప్పుడు మీరు ${after}వ స్థాయిలో ఉన్నారు.`:`Level up! You are now Level ${after}.`):''}
function finishRound(){
 clearTimer();clearAutoAdvance();$('#progress-meter').style.width='100%';go('results');playSequence([state.score===state.answeredCount?'cheer':'roundcomplete']);
 const answered=state.mode==='survival'?state.answeredCount:state.questions.length;
 $('#result-score').textContent=ui('resultScore',state.score,answered);
 {const r=state.score/Math.max(1,answered),stars=r===1?3:r>=.7?2:r>=.4?1:0,el=$('#result-stars');if(el){el.textContent='★'.repeat(stars)+'☆'.repeat(3-stars);el.dataset.stars=String(stars)}}
 const hud=$('#hud-timer');if(hud)hud.hidden=true;
 let message=state.mode==='survival'&&answered<state.questions.length?ui('survivalEnded'):state.score===answered?ui('resultPerfect'):state.score>=Math.ceil(answered*.7)?ui('resultStrong'):ui('resultTryAgain');
 let stageNotice='';if(state.activeStageId){
  const passed=stagePasses(state.score,answered),available=unlockedStage();
  if(passed&&state.activeStageId<QUIZ_STAGES.length&&state.activeStageId>=available){const next=state.activeStageId+1;saveUnlockedStage(next);stageNotice=ui('stagePassed',state.activeStageId,next)}
  else if(passed&&state.activeStageId===QUIZ_STAGES.length)stageNotice=ui('stageMastered');
  else if(!passed)stageNotice=ui('stageFailed',state.activeStageId);
  renderQuizSetup();if(stageNotice)message+=` ${stageNotice}`;
 }
 const earned=state.roundXp?` ${ui('xpCoins',state.roundXp,state.roundCoins)}${state.roundLanguage==='te'?'':' this round.'}`:'';
 const level=state.levelUps?.at(-1),lv=level?(state.roundLanguage==='te'?` ఇప్పుడు మీరు ${level}వ స్థాయిలో ఉన్నారు.`:` Level up this round: you are now Level ${level}.`):'';
 $('#result-message').textContent=`${message}${earned}${lv}`;
 announce(`${ui('roundComplete',state.score,answered)}${stageNotice?` ${stageNotice}`:''}${earned}${lv}`,true)
}
function repeatQuestion(){const q=state.questions[state.index];if(q){const progress=ui('question',state.index+1,state.questions.length);announce(`${progress}. ${q.displayQuestion} ${ui('options')}: ${q.displayAnswers.map((a,i)=>`${LETTERS[i]}, ${a}`).join('. ')}.`,true)}}
function loadSettings(){let saved={};try{saved=JSON.parse(localStorage.getItem('bq.settings')||'{}')}catch{}Object.assign(state.settings,saved);talkBackEnabled=typeof saved.talkBackEnabled==='boolean'?saved.talkBackEnabled:saved.speech!==false;state.settings.talkBackEnabled=talkBackEnabled;delete state.settings.speech;delete state.settings.voiceAnnouncements;if(!['en','te'].includes(state.settings.language))state.settings.language='en';if(!['all','easy','medium','hard','expert'].includes(state.settings.quizDifficulty))state.settings.quizDifficulty='all';if(![5,10,15].includes(Number(state.settings.quizRoundLength)))state.settings.quizRoundLength=10;state.settings.quizRoundLength=Number(state.settings.quizRoundLength);if(!Number.isInteger(Number(state.settings.quizStage))||Number(state.settings.quizStage)<0||Number(state.settings.quizStage)>QUIZ_STAGES.length)state.settings.quizStage=0;state.settings.quizStage=Number(state.settings.quizStage);if(![0,15,30,45,60].includes(Number(state.settings.timer)))state.settings.timer=0;state.settings.timer=Number(state.settings.timer);if(!AUTO_ADVANCE_OPTIONS.includes(Number(state.settings.autoAdvanceSeconds)))state.settings.autoAdvanceSeconds=DEFAULT_AUTO_ADVANCE_SECONDS;state.settings.autoAdvanceSeconds=Number(state.settings.autoAdvanceSeconds);$('#large-text').checked=!!state.settings.largeText;$('#high-contrast').checked=!!state.settings.highContrast;$('#reduced-motion').checked=!!state.settings.reducedMotion;$('#talkback-enabled').checked=talkBackEnabled;$('#timer-choice').value=String(state.settings.timer);$('#auto-advance-choice').value=String(state.settings.autoAdvanceSeconds);DOC.body.classList.toggle('large-text',state.settings.largeText);DOC.body.classList.toggle('high-contrast',state.settings.highContrast);DOC.body.classList.toggle('reduce-motion',state.settings.reducedMotion);$('#sfx-on').checked=state.settings.sfx!==false;$('#music-on').checked=state.settings.music!==false;$('#music-volume').value=String(state.settings.musicVolume??0.25);configureAudio({sfx:state.settings.sfx!==false,music:state.settings.music!==false,musicVolume:Number(state.settings.musicVolume??0.25),sfxVolume:Number(state.settings.sfxVolume??0.8)});if(!['screen','app','both'].includes(state.settings.voiceMode))state.settings.voiceMode='screen';state.settings.voicePitch=Math.min(2,Math.max(0.1,Number(state.settings.voicePitch)||1));state.settings.voiceRate=Math.min(3,Math.max(0.5,Number(state.settings.voiceRate)||1));state.settings.voiceVolume=Math.min(1,Math.max(0,Number(state.settings.voiceVolume)||0));if(typeof state.settings.voiceName!=='string')state.settings.voiceName='';state.settings.autoStart=state.settings.autoStart!==false;state.settings.swipe=state.settings.swipe!==false;applyVoiceSettings();fillVoices();syncVoiceUi();applyLanguage();syncLiveRegions()}
function saveSettings(){state.settings={...state.settings,largeText:$('#large-text').checked,highContrast:$('#high-contrast').checked,reducedMotion:$('#reduced-motion').checked,talkBackEnabled,timer:Number($('#timer-choice').value),autoAdvanceSeconds:Number($('#auto-advance-choice').value),sfx:$('#sfx-on').checked,music:$('#music-on').checked,musicVolume:Number($('#music-volume').value),sfxVolume:Number($('#sfx-volume')?.value??0.8),autoStart:$('#auto-start')?.checked!==false,swipe:$('#swipe-on')?.checked!==false,voiceMode:$('#voice-mode')?.value||'screen',voicePitch:Number($('#voice-pitch')?.value||1),voiceRate:Number($('#voice-rate')?.value||1),voiceVolume:Number($('#voice-volume')?.value??1),voiceName:$('#voice-name')?.value||''};persistQuizSettings();loadSettings();go('home',{focus:'#settings-open'})}

// ---- Profile changes: username (server-side cooldown), secret question, secret answer. The User ID never changes. ----
const COOLDOWN_DAYS=[0,7,14,30,60],cooldownDays=n=>COOLDOWN_DAYS[Math.min(Math.max(0,n),4)];
function cooldownText(iso){const ms=Date.parse(iso)-Date.now();if(!iso||!(ms>0))return '';const date=new Date(iso).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});const days=Math.ceil(ms/86400000),hours=Math.ceil(ms/3600000);const rel=ms<86400000?`${hours} ${hours===1?'hour':'hours'}`:`${days} ${days===1?'day':'days'}`;return `You can change your username again in ${rel}, on ${date}.`}
async function refreshProfile(){if(!getSession())return null;try{const d=await callApi('profile');setSession({...getSession(),profile:d.profile,loginId:d.profile.loginId||getSession()?.loginId});state.profile=d.profile;top();return d.profile}catch{if(!getSession()){state.profile=null;top()}return null}}
async function openProfileEdit(){const p=(await refreshProfile())||getSession()?.profile;if(!p){setAuthTab('login');go('auth',{focus:loginFocus()});return}const id=p.loginId||getSession()?.loginId||'';const box=$('#edit-userid');box.textContent='User ID: ';box.append(spokenId(id));box.append(DOC.createTextNode('. Permanent, it cannot be changed.'));
 const name=$('#edit-name'),note=$('#edit-name-note'),wait=cooldownText(p.nextNameChangeAt);name.value=p.name;name.removeAttribute('aria-invalid');name.readOnly=!!wait;note.textContent=wait?`${wait} Until then your username stays ${p.name}.`:`You can change your username now. After this change, the next one is possible after ${cooldownDays((p.nameChangeCount||0)+1)} days. You will sign in with your new username and the same User ID.`;
 $('#edit-question').value='';$('#edit-custom-wrap').hidden=true;$('#edit-custom-question').value='';$('#edit-question-note').textContent=p.secretQuestion?`Your current question: ${p.secretQuestion}`:'';$('#edit-answer').value='';$('#edit-current').value='';$('#edit-error').hidden=true;go('profile-edit')}
function editError(msg,field){showError('#edit-error',msg);$$('#profile-edit-form [aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));if(field){$(field).setAttribute('aria-invalid','true');setTimeout(()=>$(field).focus(),50)}}
async function saveProfile(e){e.preventDefault();$('#edit-error').hidden=true;const p=getSession()?.profile||{};const nameEl=$('#edit-name'),name=nameEl.value.trim().replace(/\s+/g,' '),sel=$('#edit-question').value,question=sel==='custom'?$('#edit-custom-question').value.trim():sel,answer=$('#edit-answer').value.trim(),current=$('#edit-current').value.trim();
 const nameChanged=!nameEl.readOnly&&name!==p.name;const payload={currentAnswer:current};if(nameChanged)payload.name=name;if(question)payload.question=question;if(answer)payload.answer=answer;
 if(!nameChanged&&!question&&!answer)return editError('Nothing to save yet. Change your username, secret question, or secret answer first.','#edit-name');
 if(nameChanged&&name.length<2)return editError('Your username needs at least two characters.','#edit-name');
 if(question&&question.length<8)return editError('Your secret question needs at least eight characters.','#edit-custom-question');
 if(question&&!answer)return editError('A new secret question needs a new secret answer.','#edit-answer');
 if(answer&&answer.length<2)return editError('Your new secret answer needs at least two characters.','#edit-answer');
 if(current.length<2)return editError('Enter your current secret answer to save your changes.','#edit-current');
 const btn=$('#profile-edit-form button[type=submit]');btn.disabled=true;announce('Saving your changes. Please wait.');
 try{const d=await callApi('update-profile',payload);setSession({...getSession(),profile:d.profile,loginId:d.profile.loginId});state.profile=d.profile;const r=getRemembered();if(r&&r.loginId===d.profile.loginId)rememberDevice(d.profile.name,r.loginId);top();
  const parts=[];if(d.changed.includes('name'))parts.push(`Your username is now ${d.profile.name}. Use it with the same User ID to sign in. ${cooldownText(d.profile.nextNameChangeAt)}`);if(d.changed.includes('question'))parts.push('Your secret question was changed.');if(d.changed.includes('answer'))parts.push('Your secret answer was changed, and any other device was signed out.');
  const notice=$('#profile-notice');notice.textContent=`Profile updated. ${parts.join(' ')||'No changes were needed.'}`;notice.hidden=false;notice.tabIndex=-1;$('#edit-current').value='';$('#edit-answer').value='';go('profile',{focus:'#profile-notice'})}
 catch(err){const code=err.message;if(code==='name_taken')editError('This username already exists. Please choose another one.','#edit-name');else if(code==='name_cooldown'){const fresh=await refreshProfile();editError(cooldownText(fresh?.nextNameChangeAt)||'You cannot change your username yet.','#edit-name')}else if(code==='wrong_answer')editError('Your current secret answer is incorrect. Please try again.','#edit-current');else if(code==='rate_limited')editError('Too many attempts. Please wait an hour and try again.');else if(!getSession()){state.profile=null;top();editError('Your session has ended. Please sign in again.')}else editError(/^invalid/.test(code)?'Please check each field and try again.':genericFailure)}
 finally{btn.disabled=false}}
const lettersGame=createLettersGame({$,announce,callApi,getSession,setSession,onProfile:p=>{state.profile=p;top()},playSfx,playSequence});
const soundMatch=createSoundMatch({$,announce,matchSounds,playMatchSound,stopMatchSound,playSfx,callApi,getSession,setSession,onProfile:p=>{state.profile=p;top()}});
const countMatch=createCountMatchUI({$,announce,playSfx,unlockAudio,canSpeak:()=>talkBackEnabled});
function openSoundMatch(){unlockAudio();go('soundmatch',{focus:'#sm-title'});soundMatch.selectLevel()}
function openCountMatch(){countMatch.open();go('countmatch',{focus:'#cm-title'})}
const feedback=createFeedback({$,announce,callApi,getSession,go,openSignIn:()=>{setAuthTab('login');go('auth',{focus:loginFocus()})}});
adminMonitor=createAdminMonitor({$,announce,callApi,go});
moderation=createModeration({$,callApi,go,announce});
roomPlay=createRoomPlay({$,announce,callApi,getSession,go,questionBank:QUESTION_BANK,matchSounds,playMatchSound:rawMatch,playSfx:rawSfx,onBroadcast:(kind,body)=>kind==='match'?rawMatch(body):livePush(kind,body),currentView:()=>state.view,refreshRoom:()=>rooms?.refreshRoom()});
social=createSocial({$,announce,callApi,getSession,go,openSignIn:()=>{setAuthTab('login');go('auth',{focus:loginFocus()})},playSfx,currentView:()=>state.view,openChat:name=>chat.openChat(name),openRoom:(id,gameId)=>rooms.openRoom(id,gameId),loadRooms:()=>rooms.loadRooms(),onRing:()=>direct.poll()});
globalThis.bqOpenNotificationById = id => social?.openNotification(id);
globalThis.bqOpenHomeFromNotification = () => go('home',{focus:'#play-featured'});
const direct=createDirect({$,announce,callApi,getSession,playSfx:rawSfx,onCallState:on=>{if(on)stopMusic();else playMusic(musicFor(state.view,state.category,state.mode))}});
initAlertSettings({$,playSfx:rawSfx,announce});
rooms=createRooms({$,announce,callApi,getSession,go,playSfx:rawSfx,playMatchSound:rawMatch,currentView:()=>state.view,categories:CATEGORY_LIST,questionBank:QUESTION_BANK,startLive,openSignIn:()=>{setAuthTab('login');go('auth',{focus:loginFocus()})}});
chat=createChat({$,announce,callApi,getSession,go,playSfx,currentView:()=>state.view,direct});
async function onAccountDeleted({profile}={}){
 const loginId=profile?.loginId||getSession()?.profile?.loginId||getSession()?.loginId||'';
 social?.stopAppNotifications();setSession(null);forgetDevice();$('#remember-session').checked=false;state.profile=null;
 if(loginId)try{localStorage.removeItem(`bq.quizProgress.v1.${loginId}`)}catch{}
 await Promise.allSettled([chat?.forgetAccount(loginId),direct?.forgetAccount(loginId)]);
 top();announce('Your account and its linked active Blind Quiz data have been deleted. You are signed out. Other devices and copies cannot be cleared remotely.');go('home',{focus:'#account-open'});
}
accountManagement=createAccountManagement({$,announce,callApi,getSession,go,onDeleted:onAccountDeleted});
function openLetters(){unlockAudio();go('letters',{focus:'#letters-game-title'});lettersGame.start()}
async function performLogout(){try{await callApi('logout')}catch{}social?.stopAppNotifications();setSession(null);$('#remember-session').checked=false;state.profile=null;top();announce('You are logged out.');go('home',{focus:'#account-open'})}
function wire(){
 const gate=$('#audio-gate'),gateStart=$('#audio-gate-start'),gateNote=$('#audio-gate-note');
 const shell=[$('#main'),$('.topbar'),$('footer'),$('.skip-link')].filter(Boolean);
 const enterApp=()=>{
  if(audioReady)return;
  // This call is deliberately synchronous in the Start button's user-gesture handler.
  let resumed;try{resumed=unlockAudio()}catch{resumed=null}
  audioReady=true;
  for(const el of shell){el.inert=false;el.removeAttribute('inert')}
  gate.hidden=true;
  playMusic(musicFor(state.view,state.category,state.mode));
  Promise.resolve(resumed).then(ready=>{if(gateNote)gateNote.textContent=ready?'Audio is ready. Adjust sound and music in Settings anytime.':'Game started. If audio is silent, check device volume and sound settings.'}).catch(()=>{});
  if(new URLSearchParams(WIN.location.search).get('game')==='count-match')openCountMatch();
  else setTimeout(()=>$('#play-featured')?.focus(),30);
 };
 gateStart.addEventListener('click',enterApp);
 gate.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation()}else if(e.key==='Tab'){e.preventDefault();gateStart.focus()}});
 // One delegated effect covers taps, keyboard activation and screen-reader activation without duplicate per-widget clicks.
 DOC.addEventListener('click',e=>{
  const button=e.target?.closest?.('button:not(:disabled):not([aria-disabled="true"]),a.button,[role="button"]:not([aria-disabled="true"])');
  if(!button||button.closest('[inert]')||button.closest('[hidden]'))return;
  if(audioReady||button.id==='audio-gate-start'){
   unlockAudio();
   if(audioReady)playMusic(musicFor(state.view,state.category,state.mode));
  }
  playSfx('click');
 },true);
 for(const eventName of ['pointerdown','keydown'])DOC.addEventListener(eventName,e=>{
  if(!audioReady||eventName==='keydown'&&(/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName||'')&&e.key===' '))return;
  unlockAudio();playMusic(musicFor(state.view,state.category,state.mode));
 },true);
 setTimeout(()=>gateStart.focus(),0);
 $('#voice-instructions').addEventListener('click',speakInstructions);
 $('#talkback-enabled').addEventListener('change',e=>setTalkBackEnabled(e.target.checked));
$('#voice-mode')?.addEventListener('change',e=>{state.settings.voiceMode=e.target.value==='app'?'app':e.target.value==='both'?'both':'screen';applyVoiceSettings();syncVoiceUi();syncLiveRegions();persistQuizSettings()});
for(const [id,key] of [['voice-pitch','voicePitch'],['voice-rate','voiceRate'],['voice-volume','voiceVolume']])$('#'+id)?.addEventListener('change',e=>{state.settings[key]=Number(e.target.value);applyVoiceSettings();syncVoiceUi();persistQuizSettings()});
$('#voice-name')?.addEventListener('change',e=>{state.settings.voiceName=e.target.value;applyVoiceSettings();syncVoiceUi();persistQuizSettings()});
$('#voice-test')?.addEventListener('click',()=>speakPreview('This is the Blind Quiz voice. The pitch, the speed and the volume are the ones you chose.'));
$('#auto-start')?.addEventListener('change',e=>{state.settings.autoStart=e.target.checked;persistQuizSettings()});
$('#swipe-on')?.addEventListener('change',e=>{state.settings.swipe=e.target.checked;persistQuizSettings()});
$('#sfx-volume')?.addEventListener('change',e=>{state.settings.sfxVolume=Number(e.target.value);configureAudio({sfxVolume:state.settings.sfxVolume});persistQuizSettings()});
// Swipe left and right moves the focus between the choices on screen. The screen reader reads whatever
// receives the focus, so the gesture never writes to a live region as well.
// A screen reader (Android TalkBack) keeps single-finger swipes for its own navigation, so the game
// also listens for a two-finger swipe, for the left and right arrow keys, and for the Previous and
// Next buttons on the game screen. A short recorded click marks every move.
const moveWithSound=(direction,{sound=true}={})=>{
  if(state.settings.swipe===false)return null;
  const el=moveFocus(direction);
  if(!el)return null;
  if(sound)playSfx('swipe');
  if(voiceMode()==='app')speakOnly(el.getAttribute('aria-label')||el.textContent||'');
  return el;
};
initGestures({onMove:el=>{el?.focus();playSfx('swipe');if(voiceMode()==='app')speakOnly(el.getAttribute('aria-label')||el.textContent||'')},enabled:()=>state.settings.swipe!==false});
DOC.addEventListener('keydown',e=>{
  if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
  if(e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(moveWithSound(e.key==='ArrowRight'?'forward':'back'))e.preventDefault();
});
// The Previous and Next buttons on the game screen move the focus the same way. The shared click
// handler already plays the short click for a button, so the move does not add a second sound.
DOC.addEventListener('click',e=>{const b=e.target?.closest?.('[data-move]');if(!b)return;moveWithSound(b.dataset.move==='forward'?'forward':'back',{sound:false});});
 $('#language-choice').addEventListener('change',e=>{state.settings.language=e.target.value==='te'?'te':'en';state.settings.quizStage=Number(state.settings.quizStage)||0;persistQuizSettings();applyLanguage();announce(ui('ready'))});
 $('#quiz-stage').addEventListener('change',e=>selectQuizStage(e.target.value));
 $('#quiz-difficulty').addEventListener('change',selectCustomQuizSetting);$('#quiz-round-length').addEventListener('change',selectCustomQuizSetting);
 $('.brand')?.addEventListener('click',e=>{e.preventDefault();go('home',{focus:'#play-featured'})});
 // A quick second activation of the same control (a double tap) must not run the action twice:
// it would start a second round, or throw away a puzzle that is already in progress.
// One activation is one action. A double click is ignored, and a second activation that
// arrives in the same tick (a control that has two handlers) never starts a second round.
const isDoubleActivation=e=>!!e&&typeof e.detail==='number'&&e.detail>=2;
const onceAction=(fn,e)=>{if(isDoubleActivation(e))return;fn();playSfx('notify')};
$('#play-featured').addEventListener('click',e=>onceAction(()=>startRound('general','classic'),e));
$('#category-list').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(b)onceAction(()=>startRound(b.dataset.category,'classic'),e)});
$('#mode-list').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;onceAction(()=>{if(b.dataset.mode==='letters')openLetters();else startRound('general',b.dataset.mode)},e)});
$('#letters-open').addEventListener('click',e=>onceAction(openLetters,e));
$('#sm-open').addEventListener('click',e=>onceAction(openSoundMatch,e));
$('#cm-open').addEventListener('click',e=>onceAction(openCountMatch,e));
$('#cm-sound-open').addEventListener('click',openSoundMatch);soundMatch.wire();countMatch.wire();lettersGame.wire();$('#profile-change').addEventListener('click',openProfileEdit);$('#profile-edit-form').addEventListener('submit',saveProfile);$('#edit-question').addEventListener('change',()=>{$('#edit-custom-wrap').hidden=$('#edit-question').value!=='custom';if(!$('#edit-custom-wrap').hidden)$('#edit-custom-question').focus()});$('#random-category').addEventListener('click',e=>onceAction(()=>{const available=new Set(playableBank().map(q=>q.category)),options=CATEGORY_LIST.filter(c=>(state.settings.language==='te'?available.has(c.id):c.count>=4));const c=options[Math.floor(Math.random()*options.length)];if(c)startRound(c.id,'classic')},e));$$('[data-category="braille"]').filter(b=>!b.closest('#category-list')).forEach(b=>b.addEventListener('click',e=>onceAction(()=>startRound('braille','classic'),e)));
 $('#account-open').addEventListener('click',()=>{if(getSession()){$('#profile-notice').hidden=true;renderProfile();go('profile');refreshProfile();return}setAuthTab('login');go('auth',{focus:loginFocus()})});$('#profile-logout').addEventListener('click',performLogout);$('#forget-device').addEventListener('click',()=>{forgetDevice();$('#login-name').value='';$('#login-id').value='';$('#login-answer').value='';$('#question-context').hidden=true;$('#remembered-device').hidden=true;$('#login-name').focus();announce('This device no longer remembers your name and Login ID.')});$$('[data-auth-tab]').forEach(b=>b.addEventListener('click',()=>setAuthTab(b.dataset.authTab)));$('#signup-name-generate').addEventListener('click',()=>{generateSignupName();$('#signup-name').focus();});$('#login-form').addEventListener('submit',login);$('#signup-form').addEventListener('submit',signUp);$('#recovery-form').addEventListener('submit',e=>recoveryMode==='answer'?recoverSecretAnswer(e):recoverLoginId(e));$('#recover-open').addEventListener('click',()=>{$('#login-form').hidden=true;$('#signup-form').hidden=true;$('#recovery-form').hidden=false;setRecoveryMode('id',{speakChoice:false});const msg='Account recovery. Choose Recover Login ID or Recover secret answer.';speakText(msg);announce(msg,true)});$$('[data-recover-mode]').forEach(b=>b.addEventListener('click',()=>setRecoveryMode(b.dataset.recoverMode)));$('#recover-answer-submit')?.addEventListener('click',recoverSecretAnswer);$('#recover-answer-question')?.addEventListener('change',()=>{$('#recover-answer-custom-wrap').hidden=$('#recover-answer-question').value!=='custom';if(!$('#recover-answer-custom-wrap').hidden)$('#recover-answer-custom-question').focus()});['#recover-answer-name','#recover-answer-login-id'].forEach(sel=>$(sel)?.addEventListener('input',()=>{clearTimeout(recoveryQuestionLookupTimer);recoveryQuestionLookupTimer=setTimeout(lookupRecoveryQuestion,400)}));$('#recover-answer-continue')?.addEventListener('click',()=>{setAuthTab('login');$('#recovery-form').hidden=true;$('#login-form').hidden=false;$('#login-answer').focus()});$('#recovery-back').addEventListener('click',()=>{setAuthTab('login');$('#recovery-form').hidden=true;$('#login-form').hidden=false});$('#recovery-question').addEventListener('change',()=>{$('#recovery-custom-wrap').hidden=$('#recovery-question').value!=='custom';if(!$('#recovery-custom-wrap').hidden)$('#recovery-custom-question').focus()});$('#copy-recovered-id').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#recovered-id').textContent);announce('Login ID copied.')}catch{announce('Copy is unavailable. Select the Login ID text to copy it.')}});$('#signup-name').addEventListener('input',()=>{if(!applyingSignupNameSuggestion)signupNameSuggestionSequence++;clearTimeout(signupNameTimer);signupNameTimer=setTimeout(checkSignupName,450)});$('#secret-question').addEventListener('change',()=>{$('#custom-question-wrap').hidden=$('#secret-question').value!=='custom';if(!$('#custom-question-wrap').hidden)$('#custom-question').focus()});['#login-name','#login-id'].forEach(sel=>$(sel).addEventListener('input',()=>{clearTimeout(questionLookupTimer);questionLookupTimer=setTimeout(lookupQuestion,500)}));$('#copy-login-id').addEventListener('click',async()=>{const id=$('#new-login-id').textContent;try{await navigator.clipboard.writeText(id);announce('Login ID copied.')}catch{const r=DOC.createRange();r.selectNodeContents($('#new-login-id'));getSelection().removeAllRanges();getSelection().addRange(r);announce('Select and copy your Login ID.')}});$('#continue-login').addEventListener('click',()=>{setAuthTab('login');$('#login-name').value=$('#signup-name').value;$('#login-id').value=$('#new-login-id').textContent;go('auth',{focus:'#login-answer'})});
 // Keyboard players can press A, B, C or D to choose an option (ignored while typing in a field).
 DOC.addEventListener('keydown',e=>{if(state.view!=='game'||state.answered||e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName||''))return;const b=$(`.answer-button[data-letter="${String(e.key||'').toUpperCase()}"]`);if(b){e.preventDefault();b.focus();b.click()}});
 $('#game-start').addEventListener('click',countdownAndBegin);$('#repeat-question').addEventListener('click',repeatQuestion);$('#read-status').addEventListener('click',()=>announce(`${ui('question',state.index+1,state.questions.length)}. ${state.roundLanguage==='te'?`స్కోరు ${state.score}.`:`Score ${state.score}.`}`));$('#play-again').addEventListener('click',()=>startRound(state.category,state.mode));$('#back-to-room').addEventListener('click',()=>{if(lastRoom)rooms.openRoom(lastRoom)});$('#direct-call-audio').addEventListener('click',()=>chat.friend&&direct.startCall(chat.friend,false));$('#direct-call-video').addEventListener('click',()=>chat.friend&&direct.startCall(chat.friend,true));$('#direct-send-file').addEventListener('click',()=>$('#direct-file-input').click());$('#direct-file-input').addEventListener('change',e=>{const f=e.target.files?.[0];e.target.value='';if(f&&chat.friend)direct.startFile(chat.friend,f)});$('#settings-open').addEventListener('click',()=>go('settings'));$('#reload-button').addEventListener('click',()=>{announce('Reloading Blind Quiz to get the latest version.',true);setTimeout(()=>purgeCachesAndReload(),500)});
 $('#check-update')?.addEventListener('click',async()=>{const status=$('#update-status');if(status)status.textContent='Checking…';await showBuildInfo();const newer=/newer build is available/i.test(status?.textContent||'');if(newer){if(status)status.textContent='A newer build is available. Loading it now…';announce('A newer build is available. Loading it now.',true);setTimeout(()=>purgeCachesAndReload(),400)}else if(status)status.textContent='This is the latest build.'});
 $('#build-info')?.addEventListener?.('click',()=>showBuildInfo());$('#save-settings').addEventListener('click',saveSettings);$('#welcome-continue').addEventListener('click',()=>go('home',{focus:'#play-featured'}));$('#profile-auth').addEventListener('click',()=>{ setAuthTab('login');go('auth',{focus:loginFocus()})});$('#logout-button').addEventListener('click',performLogout);$$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));$('#login-name').addEventListener('input',()=>$('#question-context').hidden=true);
}
// The build stamp tells the player which build is live, so "the app looks different on my
// phone" can be answered by reading one line instead of guessing.
async function showBuildInfo(){
 const el=$('#build-info');if(!el)return;
 const here=DOC.querySelector('meta[name="bq-build"]')?.content||'local';
 try{
  const res=await fetch('version.json',{cache:'no-store'});const info=await res.json();
  const newest=info?.build||'unknown';
  el.textContent=`Version: ${newest} (built ${String(info?.built||'').slice(0,16).replace('T',' ')||'unknown'}). This page: ${here}.`;
  if(newest!=='unknown'&&here!=='local'&&newest!==here){
   const status=$('#update-status');if(status)status.textContent='A newer build is available. Use Reload to get it.';
  }
 }catch{el.textContent=`Version: ${here}. The live build could not be checked.`}
}
// "Reload" really means reload: the service worker and its offline copy are dropped first, so
// an older build cannot survive on the device.
async function purgeCachesAndReload(){
 try{if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()))}}
 catch{}
 try{if(globalThis.caches){const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)))}}catch{}
 try{WIN.location.reload()}catch{}
}
// A new build takes over as soon as it is installed. The page reloads itself, so a phone that
// has the app installed never keeps playing the previous version. The very first install (no
// controller yet) does not reload.
function watchForUpdates(){
 if(!('serviceWorker'in navigator))return;
 const hadController=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadController)return;try{WIN.location.reload()}catch{}});
}
// The player's voice settings are handed to the speech module, so a device without a speech engine
// simply keeps using the live regions.
function applyVoiceSettings(){configureSpeech({mode:state.settings.voiceMode||'screen',pitch:Number(state.settings.voicePitch)||1,rate:Number(state.settings.voiceRate)||1,volume:Number(state.settings.voiceVolume??1),voice:state.settings.voiceName||''})}
// Fills the voice list with the voices this device has. A device with no voice keeps the default.
function fillVoices(){const sel=$('#voice-name');if(!sel)return;const wanted=state.settings.voiceName??'';const list=speechVoices();const keep=sel.value||wanted;sel.replaceChildren();const first=DOC.createElement('option');first.value='';first.textContent=list.length?'System default voice':'System default voice (no extra voices on this device)';sel.append(first);for(const v of list){const o=DOC.createElement('option');o.value=v.uri||v.name;o.textContent=`${v.name} (${v.lang})`;sel.append(o)}sel.value=list.some(v=>(v.uri||v.name)===keep)?keep:'';state.settings.voiceName=sel.value}
// Shows the saved voice settings and says who is reading the game.
function syncVoiceUi(){const mode=$('#voice-mode');if(mode)mode.value=voiceMode();for(const [id,key] of [['voice-pitch','voicePitch'],['voice-rate','voiceRate'],['voice-volume','voiceVolume']])if($('#'+id))$('#'+id).value=String(state.settings[key]??1);const status=$('#voice-status');if(!status)return;const nameOf=id=>$('#'+id)?.selectedOptions?.[0]?.textContent||'';const off=voiceMode()==='screen';
status.textContent=off?'Your screen reader reads the game messages.':`The game's own voice reads the game messages. Pitch: ${nameOf('voice-pitch')}. Speed: ${nameOf('voice-rate')}. Volume: ${nameOf('voice-volume')}.`;for(const id of ['voice-pitch','voice-rate','voice-volume','voice-name'])if($('#'+id))$('#'+id).disabled=off;
if(!speechSupported())$('#voice-status').textContent='This device has no game voice, so your screen reader reads the game messages.'}
// After a reload the stored session is re-validated by the server; a signed-out or otherwise revoked session is cleared.
async function restoreSession(){const s=getSession();if(!s)return;try{const d=await callApi('profile');state.profile=d.profile;setSession({...getSession(),profile:d.profile});top()}catch(err){if(err.message==='account_restricted'){setSession(null);state.profile=null;top();setAuthTab('login');const message='This account is restricted after admin review. Contact the Blind Quiz administrator if you think this is a mistake.';showError('#login-error',message);go('auth',{focus:'#login-name',confirmed:true});announce(message,true)}else if(!getSession()){state.profile=null;top();announce('Your session has ended. Please sign in again.')}}}
function onHistory(e){if(skipPop){skipPop=false;return}const v=e.state?.bqView||'home';if(v===state.view)return;if(needsExitConfirm(v)){try{history.pushState({bqView:state.view},'')}catch{}askExit(()=>go(v,{confirmed:true,focus:v==='home'?'#play-featured':undefined}));return}if(state.view==='game')clearTimer();go(v,{fromHistory:true,focus:v==='home'?'#play-featured':undefined})}
function init(){if(!/Android/i.test(navigator.userAgent||'')){const dl=$('#apk-download'),note=$('#apk-device-note');if(dl)dl.hidden=true;if(note)note.hidden=false}preloadAudio();try{if(history.state?.bqView)history.replaceState(null,'')}catch{}WIN.addEventListener('popstate',onHistory);renderCategories();renderTotals();if(/; wv\)/.test(navigator.userAgent||'')){const ac=$('#app-callout');if(ac)ac.hidden=true}renderModes();loadSettings();watchLiveRegions();wire();wireContact();top();restoreSession();try{if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{})}catch{}watchForUpdates();showBuildInfo();announce(ui('welcome'))}
// Settings > Contact us: mailto links are blocked inside older app versions, so the address can also be copied.
function wireContact(){const btn=$('#copy-email');if(!btn)return;btn.addEventListener('click',async()=>{const email=$('#contact-email').textContent.trim();let ok=false;try{await navigator.clipboard.writeText(email);ok=true}catch{const t=DOC.createElement('textarea');t.value=email;t.setAttribute('readonly','');t.className='sr-only';DOC.body.append(t);t.select();try{ok=DOC.execCommand('copy')}catch{ok=false}t.remove()}const msg=ok?`Email address copied: ${email}`:`Email address: ${email}`;$('#copy-email-status').textContent=msg;announce(msg)})}
init();
