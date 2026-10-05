// Behavioural UI test (jsdom): session restore after reload, expiry, offline, friendly errors, storage hygiene,
// legal links. Run: npm i --no-save jsdom@24 && node tests/ui-session.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const html=readFileSync(ROOT+'index.html','utf8').replace(/<script[^>]*><\/script>/g,'');
let n=0;
async function boot({session,fetchImpl,local}){
  const dom=new JSDOM(html,{url:'https://mahicouragw.github.io/Blind-Quiz/',pretendToBeVisual:true});
  const w=dom.window;
  for(const k of ['window','document','localStorage','sessionStorage','navigator','getSelection','HTMLElement','Node','history','location','Audio','HTMLMediaElement'])Object.defineProperty(globalThis,k,{value:w[k],configurable:true,writable:true});
  w.scrollTo=()=>{};globalThis.scrollTo=()=>{};
  for(const [k,v] of Object.entries(local||{}))w.localStorage.setItem(k,JSON.stringify(v));
  if(session)w.sessionStorage.setItem('blindquiz.session.v1',JSON.stringify(session));
  const calls=[];globalThis.fetch=async(url,init)=>{if(init?.body)calls.push(JSON.parse(init.body).action);return fetchImpl(url,init)};
  await import(ROOT+'src/main.js?'+(++n));
  await new Promise(r=>setTimeout(r,200));
  return {w,d:w.document,calls};
}
const json=(status,body)=>({ok:status<300,status,json:async()=>body});
const future=new Date(Date.now()+86400000).toISOString(), past=new Date(Date.now()-1000).toISOString();
const profile={name:'Asha',xp:10,coins:2,level:1};
// 1. No session
let t=await boot({fetchImpl:()=>{throw new Error('no network expected')}});
assert.equal(t.d.querySelector('#top-meta').textContent,'');assert.equal(t.d.querySelector('#logout-button').hidden,true);assert.equal(t.calls.length,0);
assert(!/playable questions/i.test(t.d.body.textContent),'no question count');
const pl=t.d.querySelector('#privacy-link'),tl=t.d.querySelector('#terms-link');
assert.equal(pl.textContent,'Privacy Policy');assert.equal(tl.textContent,'Terms and Conditions');
assert.equal(pl.href,'https://mahicouragw.github.io/Blind-Quiz/privacy-policy.html');assert.equal(tl.href,'https://mahicouragw.github.io/Blind-Quiz/terms-and-conditions.html');
assert(pl.closest('#view-settings')&&tl.closest('#view-settings'),'links in Settings');
t.d.querySelector('#settings-open').click();await new Promise(r=>setTimeout(r,100));assert.equal(t.d.querySelector('#view-settings').hidden,false);
console.log('ok 1 signed-out load, no internal counts, legal links in Settings');
// 2. Valid session survives reload
t=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile},fetchImpl:()=>json(200,{ok:true,profile:{...profile,xp:20}})});
assert.deepEqual(t.calls,['profile']);assert.match(t.d.querySelector('#top-meta').textContent,/Asha/);assert.equal(t.d.querySelector('#logout-button').hidden,false);
assert.equal(JSON.parse(t.w.sessionStorage.getItem('blindquiz.session.v1')).profile.xp,20);
console.log('ok 2 valid session restored after reload and re-validated by server');
// 3. Revoked/expired on server
t=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile},fetchImpl:()=>json(401,{ok:false,code:'session_expired'})});
assert.equal(t.w.sessionStorage.getItem('blindquiz.session.v1'),null);assert.equal(t.d.querySelector('#top-meta').textContent,'');assert.equal(t.d.querySelector('#logout-button').hidden,true);
await new Promise(r=>setTimeout(r,100));assert.match(t.d.querySelector('#announcer').textContent,/session has ended/i);
console.log('ok 3 server-rejected session cleared; signed-out state with announcement');
// 4. Locally expired
t=await boot({session:{token:'x'.repeat(43),expiresAt:past,profile},fetchImpl:()=>{throw new Error('no call')}});
assert.equal(t.calls.length,0);assert.equal(t.w.sessionStorage.getItem('blindquiz.session.v1'),null);assert.equal(t.d.querySelector('#logout-button').hidden,true);
console.log('ok 4 locally expired session discarded without network');
// 5. Offline: keep session
t=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile},fetchImpl:()=>{throw new TypeError('Failed to fetch')}});
assert(t.w.sessionStorage.getItem('blindquiz.session.v1'));assert.equal(t.d.querySelector('#logout-button').hidden,false);
console.log('ok 5 offline reload keeps the session (no false logout)');
// 6. Login failure shows generic message, no codes
t=await boot({fetchImpl:()=>json(500,{ok:false,code:'service_error'})});
t.d.querySelector('#account-open').click();await new Promise(r=>setTimeout(r,80));
t.d.querySelector('#login-name').value='Asha';t.d.querySelector('#login-id').value='ABCDEFGH';t.d.querySelector('#login-answer').value='blue';
t.d.querySelector('#login-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,150));
const err=t.d.querySelector('#login-error');assert.equal(err.hidden,false);assert(!/service_error|500|supabase/i.test(err.textContent),err.textContent);
assert.equal(t.w.localStorage.getItem('blindquiz.remembered.v1'),null,'nothing remembered on failure');
console.log('ok 6 failed login shows friendly error only:',JSON.stringify(err.textContent));
// 7. Successful login stores token only in sessionStorage, never the answer
t=await boot({fetchImpl:(u,i)=>{const a=JSON.parse(i.body).action;return a==='login'?json(200,{ok:true,firstLogin:false,token:'t'.repeat(43),expiresAt:future,profile}):json(200,{ok:true,question:'Q?'})}});
t.d.querySelector('#account-open').click();await new Promise(r=>setTimeout(r,80));
t.d.querySelector('#login-name').value='Asha';t.d.querySelector('#login-id').value='ABCDEFGH';t.d.querySelector('#login-answer').value='mysecret';
t.d.querySelector('#login-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,150));
const all=JSON.stringify({...t.w.localStorage})+JSON.stringify({...t.w.sessionStorage});
assert(!all.includes('mysecret'));assert(!JSON.stringify({...t.w.localStorage}).includes('tttt'),'token not in localStorage');assert.equal(t.d.querySelector('#login-answer').value,'');
console.log('ok 7 login: token only in sessionStorage, secret answer never stored');
// 8. Logout clears
t.d.querySelector('#logout-button').click();await new Promise(r=>setTimeout(r,100));
assert.equal(t.w.sessionStorage.getItem('blindquiz.session.v1'),null);assert.equal(t.d.querySelector('#logout-button').hidden,true);
console.log('ok 8 logout clears session');
// 9. Back button returns from a sub-view to Home (Android WebView back / browser back)
t=await boot({fetchImpl:()=>{throw new Error('none')}});
const L0=t.w.history.length;
t.d.querySelector('#settings-open').click();await new Promise(r=>setTimeout(r,50));
assert.equal(t.w.history.length,L0+1,'opening Settings adds one history entry');
t.w.history.back();await new Promise(r=>setTimeout(r,120));
assert.equal(t.d.querySelector('#view-home').hidden,false);assert.equal(t.d.querySelector('#view-settings').hidden,true);
t.d.querySelector('#account-open').click();await new Promise(r=>setTimeout(r,50));
t.d.querySelector('#view-auth [data-go="home"]').click();await new Promise(r=>setTimeout(r,150));
assert.equal(t.d.querySelector('#view-home').hidden,false);assert.equal(t.w.history.state,null,'returning Home via the page button pops the sub-view entry');
console.log('ok 9 back navigation returns to Home');
// 10. Every category and every mode starts, plays to the results screen, and Play again works.
{
  const fast=globalThis.setTimeout;globalThis.setTimeout=(f,ms)=>fast(f,Math.min(ms||0,2));
  t=await boot({fetchImpl:()=>{throw new Error('offline')}});
  const d=t.d,wait=ms=>new Promise(r=>fast(r,ms));
  const play=async()=>{d.querySelector('#game-start').click();for(let i=0;i<100&&!d.querySelector('.answer-button');i++)await wait(5);assert(d.querySelector('.answer-button'),'question appears after the countdown');
    for(let g=0;g<12&&d.querySelector('#view-results').hidden;g++){d.querySelector('.answer-button:not([aria-disabled])')?.click();await wait(5);d.querySelector('.next-question')?.click();await wait(5)}
    assert.equal(d.querySelector('#view-results').hidden,false,'round reaches results')};
  const cats=[...d.querySelectorAll('#category-list [data-category]')].map(b=>b.dataset.category);
  assert.equal(cats.length,20);
  for(const c of cats){d.querySelector('#view-results [data-go="home"]')?.click();go:{d.querySelector(`#category-list [data-category="${c}"]`).click()}await wait(5);assert.equal(d.querySelector('#view-game').hidden,false,`${c} opens`);await play()}
  for(const m of [...d.querySelectorAll('#mode-list [data-mode]')].map(b=>b.dataset.mode).filter(m=>m!=='letters')){d.querySelector('#view-results [data-go="home"]').click();await wait(5);d.querySelector(`#mode-list [data-mode="${m}"]`).click();await wait(5);await play()}
  d.querySelector('#play-again').click();await wait(5);await play();
  // Leave during the countdown, then start a different game straight away.
  d.querySelector('#view-results [data-go="home"]').click();await wait(5);
  d.querySelector('#category-list [data-category="business"]').click();await wait(5);d.querySelector('#game-start').click();await wait(3);
  d.querySelector('#view-game .back-link').click();await wait(5);
  d.querySelector('#category-list [data-category="history"]').click();await wait(5);
  assert.match(d.querySelector('#round-label').textContent,/HISTORY/);await play();
  // Leave mid-question with a timer running: nothing fires later and the next game opens.
  d.querySelector('#view-results [data-go="home"]').click();await wait(5);
  d.querySelector('#mode-list [data-mode="rapid"]').click();await wait(5);d.querySelector('#game-start').click();for(let i=0;i<100&&!d.querySelector('.answer-button');i++)await wait(5);
  d.querySelector('#view-game .back-link').click();await wait(60);assert.equal(d.querySelector('#view-home').hidden,false,'timer does not drag the player back');
  d.querySelector('#random-category').click();await wait(5);assert.equal(d.querySelector('#view-game').hidden,false,'Surprise me opens a game');await play();
  d.querySelector('#view-results [data-go="home"]').click();await wait(5);d.querySelector('.callout [data-category="braille"]').click();await wait(5);assert.match(d.querySelector('#round-label').textContent,/BRAILLE/);
  globalThis.setTimeout=fast;
  console.log(`ok 10 all ${cats.length} categories and 6 modes play to results; leaving mid-countdown/mid-timer never blocks the next game`);
}
// 11. Signed-in players see their profile, not a sign-in prompt.
t=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile:{...profile,name:'goldfish',questionsAnswered:4,questionsCorrect:3,currentStreak:2,bestStreak:3}},fetchImpl:()=>json(200,{ok:true,profile:{...profile,name:'goldfish',questionsAnswered:4,questionsCorrect:3,currentStreak:2,bestStreak:3}})});
assert.equal(t.d.querySelector('#top-meta').textContent,'Signed in as goldfish');
assert.equal(t.d.querySelector('#account-open').textContent,'Your profile: goldfish');
t.d.querySelector('#account-open').click();await new Promise(r=>setTimeout(r,80));
assert.equal(t.d.querySelector('#view-profile').hidden,false);assert.equal(t.d.querySelector('#profile-auth').hidden,true);
assert.match(t.d.querySelector('#profile-stats').textContent,/Player, goldfish.*Level, .*XP, .*Coins, .*3, 75 percent/s);
console.log('ok 11 signed-in player sees "Signed in as goldfish" and a profile with stats');
// 12. Recorded sounds: correct/wrong answers, countdown, GO, results, and music per screen.
{
  const fast=globalThis.setTimeout;globalThis.setTimeout=(f,ms)=>fast(f,Math.min(ms||0,2));
  const manifestBody=JSON.parse(readFileSync(ROOT+'assets/audio/manifest.json','utf8'));
  t=await boot({fetchImpl:(u)=>String(u).includes('manifest.json')?json(200,manifestBody):(()=>{throw new Error('offline')})()});
  const played=[];t.w.HTMLMediaElement.prototype.play=function(){played.push(this.src.split('/').pop());return Promise.resolve()};t.w.HTMLMediaElement.prototype.pause=function(){};
  const d=t.d,wait=ms=>new Promise(r=>fast(r,ms));
  d.dispatchEvent(new t.w.Event('pointerdown'));await wait(20);
  assert(played.includes('music_menu.mp3'),'home music after the first tap: '+JSON.stringify(played));
  d.querySelector('#category-list [data-category="business"]').click();await wait(20);
  assert(played.includes('music_game3.mp3'),'business has its own game music');
  d.querySelector('#game-start').click();for(let i=0;i<100&&!d.querySelector('.answer-button');i++)await wait(5);
  assert(played.includes('click.mp3')&&played.filter(x=>x==='tick.mp3').length===3&&played.includes('go.mp3'),'countdown click, 3 ticks, GO whistle');
  const titleQ=d.querySelector('#game-title').textContent;
  const btns=[...d.querySelectorAll('.answer-button')];
  // pick the correct one by checking the question bank
  const { QUESTION_BANK }=await import(ROOT+'src/content.js');
  const q=QUESTION_BANK.find(x=>titleQ.endsWith(x.question));btns.find(b=>b.dataset.answer===q.correctAnswer).click();await wait(20);
  assert(played.includes('correct.mp3'),'correct answer plays the bell');
  d.querySelector('.next-question').click();await wait(10);
  const q2=QUESTION_BANK.find(x=>d.querySelector('#game-title').textContent.endsWith(x.question));[...d.querySelectorAll('.answer-button')].find(b=>b.dataset.answer!==q2.correctAnswer).click();await wait(20);
  assert(played.includes('wrong.mp3'),'wrong answer plays the buzzer');
  for(let g=0;g<12&&d.querySelector('#view-results').hidden;g++){d.querySelector('.next-question')?.click();await wait(5);d.querySelector('.answer-button:not([aria-disabled])')?.click();await wait(5)}
  assert(played.includes('applause.mp3')||played.includes('cheer.mp3'),'results applause');assert(played.includes('music_results.mp3'),'results music');
  // Settings: turning sound effects off silences them.
  d.querySelector('#settings-open').click();await wait(10);d.querySelector('#sfx-on').checked=false;d.querySelector('#save-settings').click();await wait(10);
  const before=played.length;d.querySelector('#category-list [data-category="animals"]').click();await wait(10);d.querySelector('#game-start').click();for(let i=0;i<100&&!d.querySelector('.answer-button');i++)await wait(5);
  assert(!played.slice(before).some(x=>/^(click|tick|go)\.mp3$/.test(x)),'sound effects can be switched off');
  globalThis.setTimeout=fast;
  console.log('ok 12 recorded sounds for countdown, GO, correct, wrong, results, and per-screen music; switchable in Settings');
}
// 13. TalkBack: after answering, focus lands on the result (verdict, correct answer, XP, coins, streak), never on sign-in UI.
{
  const fast=globalThis.setTimeout;globalThis.setTimeout=(f,ms)=>fast(f,Math.min(ms||0,2));
  const { QUESTION_BANK }=await import(ROOT+'src/content.js');
  const p0={...profile,name:'goldfish',currentStreak:4,bestStreak:4,questionsAnswered:4,questionsCorrect:4};
  t=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile:p0,loginId:'ABCD2345'},fetchImpl:(u,init)=>{const b=init?.body?JSON.parse(init.body):{};
    if(b.action==='record-answer'){const q=QUESTION_BANK.find(x=>x.id===b.questionId);const ok=b.choice===q.correctAnswer;return json(200,{ok:true,correct:ok,answer:q.correctAnswer,explanation:q.explanation,xp:ok?10:0,coins:ok?2:0,profile:{...p0,currentStreak:ok?5:0}})}
    return json(200,{ok:true,profile:p0})}});
  const d=t.d,wait=ms=>new Promise(r=>fast(r,ms));
  assert(!d.querySelector('#top-meta').hasAttribute('aria-live'),'header is not a live region');
  d.querySelector('#category-list [data-category="business"]').click();await wait(10);
  for(const v of d.querySelectorAll('.view'))if(v.id!=='view-game')assert(v.hidden&&v.inert&&v.getAttribute('aria-hidden')==='true',`${v.id} hidden from the accessibility tree`);
  assert(d.querySelector('#view-auth').inert,'sign-in view is inert during a game');
  d.querySelector('#game-start').click();for(let i=0;i<100&&!d.querySelector('.answer-button');i++)await wait(5);
  const q=QUESTION_BANK.find(x=>d.querySelector('#game-title').textContent.endsWith(x.question));
  const right=[...d.querySelectorAll('.answer-button')].find(b=>b.dataset.answer===q.correctAnswer);right.focus();right.click();
  for(let i=0;i<50&&!d.querySelector('.next-question');i++)await wait(5);await wait(20);
  const fb=d.querySelector('#answer-feedback');
  assert.equal(d.activeElement,fb,'focus moves to the result, got '+(d.activeElement?.id||d.activeElement?.tagName));
  assert.match(fb.textContent,/^Correct! The answer is .+ You earned 10 XP and 2 coins\. Streak: 5 in a row\./);
  assert(fb.compareDocumentPosition(d.querySelector('.next-question'))&4,'Next question follows the result');
  assert(!d.activeElement.closest('#view-auth, form, input'),'focus is not on sign-in UI');
  assert(!d.querySelectorAll('.answer-button[disabled]').length,'answer buttons stay focusable (aria-disabled)');
  assert.equal(right.getAttribute('aria-label'),`Option ${right.dataset.letter}: ${q.correctAnswer}, correct answer, your answer`);
  for(const id of ['#announcer','#assertive-announcer'])assert(!/sign in|signed in/i.test(d.querySelector(id).textContent),'no sign-in announcement');
  d.querySelector('.next-question').click();await wait(10);
  const q2=QUESTION_BANK.find(x=>d.querySelector('#game-title').textContent.endsWith(x.question));
  assert.equal(d.activeElement,d.querySelector('#game-title'),'next question receives focus');
  [...d.querySelectorAll('.answer-button')].find(b=>b.dataset.answer!==q2.correctAnswer).click();
  for(let i=0;i<50&&!d.querySelector('.next-question');i++)await wait(5);await wait(20);
  assert.equal(d.activeElement,d.querySelector('#answer-feedback'));
  assert.match(d.activeElement.textContent,new RegExp(`^Incorrect\\. You chose [A-D]: .+ The correct answer is [A-D]: ${q2.correctAnswer.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\..*Streak reset\\.`));
  globalThis.setTimeout=fast;
  console.log('ok 13 TalkBack: result focused after each answer (verdict, answer, XP, coins, streak); hidden views inert; no sign-in announcements');
}
// 14. Profile Change: read-only User ID, username cooldown message, uniqueness error, current answer required, instant refresh.
{
  const fast=globalThis.setTimeout;globalThis.setTimeout=(f,ms)=>fast(f,Math.min(ms||0,2));
  let server={name:'goldfish',loginId:'ABCD2345',secretQuestion:'What is your favorite color?',nameChangeCount:0,nextNameChangeAt:null,xp:90,coins:18,level:1,currentStreak:5,bestStreak:5,questionsAnswered:10,questionsCorrect:9,quizzesCompleted:1};
  const bodies=[];
  t=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile:server,loginId:'ABCD2345'},fetchImpl:(u,init)=>{const b=init?.body?JSON.parse(init.body):{};
    if(b.action==='update-profile'){bodies.push(b);if(b.currentAnswer!=='blue')return json(403,{ok:false,code:'wrong_answer'});if(b.name&&b.name.toLowerCase()==='shark')return json(409,{ok:false,code:'name_taken'});
      const changed=[];if(b.name){server={...server,name:b.name,nameChangeCount:server.nameChangeCount+1,nextNameChangeAt:new Date(Date.now()+7*86400000).toISOString()};changed.push('name')}if(b.question){server={...server,secretQuestion:b.question};changed.push('question')}if(b.answer)changed.push('answer');return json(200,{ok:true,changed,profile:server})}
    return json(200,{ok:true,profile:server})}});
  const d=t.d,wait=ms=>new Promise(r=>fast(r,ms)),$=q=>d.querySelector(q);
  $('#account-open').click();await wait(20);
  assert(!$('#view-profile dl, #view-profile dt, #view-profile dd'),'no definition-list semantics on the profile');
  const rows=[...d.querySelectorAll('#profile-stats li')].map(li=>li.textContent);
  for(const r of ['Player, goldfish','Level, 1','XP, 90','Coins, 18','Current streak, 5','Best streak, 5','Questions answered, 10','Correct answers, 9, 90 percent'])assert(rows.includes(r),'profile row: '+r+' in '+JSON.stringify(rows));
  assert(rows.some(r=>r.startsWith('User ID, ABCD2345')),'User ID row');
  assert.equal($('#profile-change').hidden,false);assert.equal($('#profile-change').textContent,'Change');
  $('#profile-change').click();await wait(20);
  assert.equal($('#view-profile-edit').hidden,false);
  assert.match($('#edit-userid').textContent,/User ID: ABCD2345A B C D 2 3 4 5\. Permanent, it cannot be changed\./);assert(!$('#edit-userid input'),'User ID is not an editable field');
  assert.equal($('#edit-name').value,'goldfish');assert.match($('#edit-name-note').textContent,/change your username now.*after 7 days/);
  assert.match($('#edit-question-note').textContent,/favorite color/);
  $('#edit-name').value='Whale';$('#profile-edit-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await wait(20);
  assert.match($('#edit-error').textContent,/current secret answer/);assert.equal(d.activeElement,$('#edit-current'));assert.equal(bodies.length,0,'nothing sent without the current answer');
  $('#edit-name').value='SHARK';$('#edit-current').value='blue';$('#profile-edit-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await wait(20);
  assert.equal($('#edit-error').textContent,'This username already exists. Please choose another one.');assert.equal(d.activeElement,$('#edit-name'));assert.equal($('#edit-name').getAttribute('aria-invalid'),'true');
  $('#edit-name').value='Whale';$('#edit-current').value='green';$('#profile-edit-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await wait(20);
  assert.match($('#edit-error').textContent,/incorrect/);
  $('#edit-name').value='Whale';$('#edit-current').value='blue';$('#profile-edit-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));for(let i=0;i<40&&d.activeElement!==$('#profile-notice');i++)await wait(5);
  assert.equal($('#view-profile').hidden,false,'back on the profile');assert.equal(d.activeElement,$('#profile-notice'),'focus on '+d.activeElement.id+' notice='+$('#profile-notice').textContent+' tab='+$('#profile-notice').tabIndex);
  assert.match($('#profile-notice').textContent,/^Profile updated\. Your username is now Whale\..*again in 7 days, on /);
  assert.equal($('#top-meta').textContent,'Signed in as Whale');assert([...d.querySelectorAll('#profile-stats li')].some(li=>li.textContent==='Player, Whale'),'profile shows the new name at once');
  const ss=JSON.parse(t.w.sessionStorage.getItem('blindquiz.session.v1'));assert.equal(ss.profile.name,'Whale');assert.equal(ss.loginId,'ABCD2345');
  for(const b of bodies)assert(Object.keys(b).every(k=>['action','currentAnswer','name','question','answer'].includes(k)),'only own-profile fields are sent; no user id');
  $('#profile-change').click();await wait(20);
  assert.equal($('#edit-name').readOnly,true,'username locked during the cooldown');assert.match($('#edit-name-note').textContent,/^You can change your username again in 7 days, on .+\. Until then your username stays Whale\./);
  $('#edit-question').value='Who was your first teacher?';$('#edit-question').dispatchEvent(new t.w.Event('change'));$('#edit-current').value='blue';$('#profile-edit-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await wait(20);
  assert.match($('#edit-error').textContent,/needs a new secret answer/);assert.equal(d.activeElement,$('#edit-answer'));
  $('#edit-answer').value='Mrs Rao';$('#profile-edit-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await wait(30);
  assert.match($('#profile-notice').textContent,/secret question was changed.*secret answer was changed/);assert(!bodies.at(-1).name,'locked username is not sent');
  assert(!t.w.localStorage.getItem('blindquiz.remembered.v1')?.includes('Mrs Rao')&&!t.w.sessionStorage.getItem('blindquiz.session.v1').includes('Mrs Rao'),'secret answer never stored in the browser');
  globalThis.setTimeout=fast;
  console.log('ok 14 profile Change: read-only User ID, cooldown message, "This username already exists.", current answer required, profile refreshes instantly');
}
// 15. Letters to Words: real letter buttons, automatic word recognition, server rewards, invalid words, level progression.
{
  const fast=globalThis.setTimeout;globalThis.setTimeout=(f,ms)=>fast(f,Math.min(ms||0,2));
  const { solutionsFor, isPrefix }=await import(ROOT+'src/letters.js');
  const p0={name:'goldfish',loginId:'ABCD2345',xp:90,coins:18,level:1,currentStreak:5,bestStreak:5,questionsAnswered:10,questionsCorrect:9};
  const words=[];let xp=90;
  t=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile:p0,loginId:'ABCD2345'},fetchImpl:(u,init)=>{const b=init?.body?JSON.parse(init.body):{};
    if(b.action==='record-word'){words.push(b);xp+=b.word.length-1;return json(200,{ok:true,valid:true,alreadyFound:false,xp:b.word.length-1,coins:1,profile:{...p0,xp,currentStreak:6}})}
    return json(200,{ok:true,profile:p0})}});
  const d=t.d,wait=ms=>new Promise(r=>fast(r,ms)),$=q=>d.querySelector(q);
  assert(d.querySelector('#mode-list [data-mode="letters"]'),'Letters to Words is listed with the game modes');
  $('#letters-open').click();await wait(20);
  assert.equal($('#view-letters').hidden,false);assert(!d.querySelector('#view-letters input, #view-letters textarea'),'no typing anywhere in the game');
  const tiles=()=>[...d.querySelectorAll('#letters-tiles .letter-tile')];
  assert.equal(tiles().length,4,'level 1 has 4 letters');
  for(const b of tiles()){assert.equal(b.tagName,'BUTTON');assert.match(b.getAttribute('aria-label'),/^Letter [A-Z]$/);assert(!b.hasAttribute('aria-pressed'),'plain button: "Letter D, button"')}
  assert.match($('#letters-status').textContent,/^Level 1, Beginner\. Round 1\. Your letters are [A-Z], [A-Z], [A-Z], [A-Z]\./);
  const letters=()=>tiles().map(b=>b.textContent.toLowerCase());
  const spellWord=async w=>{const used=new Set();for(const ch of w){const i=letters().findIndex((c,k)=>c===ch&&!used.has(k));used.add(i);tiles()[i].click();await wait(3)}await wait(20)};
  // An invalid start is rejected and cleared.
  const sols=solutionsFor(letters().join(''));let bad=null;
  for(let i=0;i<4&&!bad;i++)for(let j=0;j<4&&!bad;j++)if(i!==j&&!isPrefix(letters()[i]+letters()[j],sols))bad=[i,j];
  if(bad){tiles()[bad[0]].click();await wait(3);if(!/Not a valid word/.test($('#letters-status').textContent)){tiles()[bad[1]].click();await wait(3)}assert.match($('#letters-status').textContent,/Not a valid word\. Letters cleared/);assert(tiles().every(b=>!/selected/.test(b.getAttribute('aria-label'))),'selection cleared')}
  // First letter is announced as selected, then Remove last letter undoes it.
  const first=sols[0];const i0=letters().indexOf(first[0]);tiles()[i0].click();await wait(3);
  assert.equal(tiles()[i0].getAttribute('aria-label'),`Letter ${first[0].toUpperCase()}, selected`);assert.match($('#letters-status').textContent,new RegExp(`^${first[0].toUpperCase()} selected\\. Your word: ${first[0].toUpperCase()}\\.`));
  $('#letters-remove').click();await wait(3);assert.equal(tiles()[i0].getAttribute('aria-label'),`Letter ${first[0].toUpperCase()}`);
  // Words are recognised automatically and rewarded by the server.
  const goal=Number($('#letters-level').textContent.match(/Find (\d+) words/)[1]);
  // Words that neither extend nor contain a shorter answer as a prefix (spelling BOOT also finds BOO on the way).
  const targets=sols.filter(w=>!sols.some(x=>x!==w&&(x.startsWith(w)||w.startsWith(x)))).slice(0,goal);
  const w1=targets[0]??[...sols].sort((a,b)=>a.length-b.length)[0];await spellWord(w1);
  assert.match($('#letters-status').textContent,new RegExp(`^Word found: ${w1.toUpperCase()}\\. You earned ${w1.length-1} XP and 1 coin\\. Streak: 6\\.`));
  assert.deepEqual(words[0],{action:'record-word',letters:words[0].letters,word:w1});assert.equal([...words[0].letters].sort().join(''),letters().sort().join(''));
  assert([...d.querySelectorAll('#letters-found li')].some(li=>li.textContent===w1.toUpperCase()),'found list');
  assert.equal($('#top-meta').textContent,'Signed in as goldfish');
  for(const w of targets.slice(1))await spellWord(w);
  await wait(40);
  if(targets.length>=goal){for(let i=0;i<50&&d.activeElement!==$('#letters-status');i++)await wait(5);
    assert.match($('#letters-status').textContent,new RegExp(`Round complete! ${goal} words found\\. \\d+ level XP earned, including a 4 XP round bonus\\. \\d+ profile XP and ${goal} coins earned this round\\. Level XP: \\d+ of 30\\. \\d+ more to reach Level 2\\. Next: Round 2\\. Your letters are`));
    assert.equal(d.activeElement,$('#letters-status'),'focus moves to the round result');assert.equal(tiles().length,4,'still level 1');assert.match($('#letters-level').textContent,/^Level 1, Beginner\. Round 2\./);assert.match($('#letters-xp').textContent,/^Level XP: \d+ of 30\./)}
  // Pressing the same letter again (TalkBack keeps focus on it) uses the other copy: T, O, O -> TOO.
  let dup=null;for(let n=0;n<200&&!dup;n++){$('#letters-new').click();await wait(2);const ls=letters();const c=ls.find((x,k)=>ls.indexOf(x)!==k);if(c)dup=c}
  assert(dup,'found a puzzle with a repeated letter');
  const ls=letters(),k=ls.indexOf(dup);tiles()[k].click();await wait(3);tiles()[k].click();await wait(3);
  const picked=tiles().filter(b=>/selected/.test(b.getAttribute('aria-label')));
  assert(picked.length===2||/Word found|Not a valid word/.test($('#letters-status').textContent),'second press of the same letter used its twin: '+$('#letters-status').textContent);
  assert(!/removed/.test($('#letters-status').textContent),'pressing a chosen letter never silently removes it');
  $('#letters-clear').click();await wait(3);
  // Leaving the game and coming back keeps everything working.
  d.querySelector('#view-letters [data-go="home"]').click();await wait(10);d.querySelector('#category-list [data-category="business"]').click();await wait(10);assert.equal($('#view-game').hidden,false);
  globalThis.setTimeout=fast;
  console.log(`ok 15 Letters to Words: letter buttons ("Letter X"), automatic recognition ("Word found"), server XP/coins, invalid words cleared, level ${targets.length>=goal?'progression':'goal'} verified`);
}
// 17. Automatic level-up from level XP: round sound, then the recorded level-up sound, announcement, harder next level.
{
  const fast=globalThis.setTimeout;globalThis.setTimeout=(f,ms)=>fast(f,Math.min(ms||0,2));
  const { solutionsFor }=await import(ROOT+'src/letters.js');
  const assets=Object.fromEntries(['correct','wrong','click','applause','cheer','levelup','coin'].map(k=>[k,{file:`assets/audio/${k}.mp3`}]));
  t=await boot({local:{'bq.letters.v1':{level:1,levelXp:28,round:4,recent:[]}},fetchImpl:u=>String(u).includes('manifest.json')?json(200,{assets}):json(200,{ok:true})});
  const d=t.d,wait=ms=>new Promise(r=>fast(r,ms)),$=q=>d.querySelector(q);
  const played=[];t.w.HTMLMediaElement.prototype.play=function(){played.push(String(this.src).split('/').pop());return Promise.resolve()};t.w.HTMLMediaElement.prototype.pause=function(){};
  $('#letters-open').click();await wait(20);
  assert.match($('#letters-level').textContent,/^Level 1, Beginner\. Round 4\. 4 letters\./);assert.match($('#letters-xp').textContent,/^Level XP: 28 of 30\. 2 more to reach Level 2\./);
  const tiles=()=>[...d.querySelectorAll('#letters-tiles .letter-tile')],letters=()=>tiles().map(b=>b.textContent.toLowerCase());
  const spellWord=async w=>{const used=new Set();for(const ch of w){const i=letters().findIndex((c,k)=>c===ch&&!used.has(k));used.add(i);tiles()[i].click();await wait(3)}await wait(20)};
  const sols=solutionsFor(letters().join(''));const goal=Number($('#letters-level').textContent.match(/Find (\d+) words/)[1]);
  const targets=sols.filter(w=>!sols.some(x=>x!==w&&(x.startsWith(w)||w.startsWith(x)))).slice(0,goal);
  if(targets.length<goal){$('#letters-new').click();await wait(10)}
  const sols2=solutionsFor(letters().join(''));const targets2=sols2.filter(w=>!sols2.some(x=>x!==w&&(x.startsWith(w)||w.startsWith(x)))).slice(0,goal);
  for(const w of targets2)await spellWord(w);
  for(let i=0;i<60&&!/Level up!/.test($('#letters-status').textContent);i++)await wait(5);
  if(targets2.length>=goal){
    assert.match($('#letters-status').textContent,/Round complete! \d+ words found\. \d+ level XP earned, including a 4 XP round bonus\. Level up! You are now Level 2, Easy plus\. Now: 5 letters, more possible words, find 3 words each round\. Next: Round 1\. Your letters are [A-Z](, [A-Z]){4}\. Find \d words\./);
    for(let i=0;i<50&&d.activeElement!==$('#letters-status');i++)await wait(5);
    assert.equal(d.activeElement,$('#letters-status'),'focus moves to the level-up announcement');
    assert.equal(tiles().length,5,'level 2 is harder: 5 letters');assert.match($('#letters-level').textContent,/^Level 2, Easy plus\. Round 1\. 5 letters\./);assert.match($('#letters-xp').textContent,/^Level XP: 0 of 50\./);
    assert.equal(JSON.parse(t.w.localStorage.getItem('bq.letters.v1')).level,2,'level saved on the device');
    for(let i=0;i<100&&!played.includes('levelup.mp3');i++)await wait(5);
    const a=played.lastIndexOf('applause.mp3'),l=played.lastIndexOf('levelup.mp3');
    assert(a>=0&&l>a,'round sound, then the level-up sound: '+played.join(','));
  }
  globalThis.setTimeout=fast;
  console.log(`ok 17 automatic level-up ${targets2.length>=goal?'verified':'skipped (no prefix-free words)'}: level XP threshold, applause then bugle level-up sound, "Level up! You are now Level 2", 5-letter level, focus on the announcement`);
}
// 16. Options are A, B, C, D; "Question 1 of 10" is spoken once (title only), never repeated on every option.
{
  const fast=globalThis.setTimeout;globalThis.setTimeout=(f,ms)=>fast(f,Math.min(ms||0,2));
  t=await boot({fetchImpl:()=>{throw new Error('offline')}});
  const d=t.d,wait=ms=>new Promise(r=>fast(r,ms)),$=q=>d.querySelector(q);
  $('#category-list [data-category="history"]').click();await wait(10);$('#game-start').click();for(let i=0;i<100&&!d.querySelector('.answer-button');i++)await wait(5);
  const btns=[...d.querySelectorAll('.answer-button')];
  assert.equal(btns.length,4);
  btns.forEach((b,i)=>{const L='ABCD'[i];assert.equal(b.dataset.letter,L);assert.equal(b.getAttribute('aria-label'),`Option ${L}: ${b.dataset.answer}`);assert.equal(b.querySelector('.answer-letter').textContent,L);assert.equal(b.querySelector('.answer-letter').getAttribute('aria-hidden'),'true');assert(!b.hasAttribute('aria-describedby'),'options do not repeat the progress')});
  assert.match($('#game-title').textContent,/^Question 1 of 10\. /);assert.equal($('#round-progress').getAttribute('aria-hidden'),'true');
  const spoken=[...d.querySelectorAll('#view-game *')].filter(el=>!el.closest('[aria-hidden="true"]')&&el.children.length===0).map(el=>el.getAttribute('aria-label')||el.textContent).join(' | ');
  assert.equal((spoken.match(/Question 1 of 10/g)||[]).length,1,'"Question 1 of 10" is exposed once: '+spoken);
  $('#repeat-question').click();await wait(10);
  assert.match($('#assertive-announcer').textContent,/^Question 1 of 10\. .+ Options: A, .+\. B, .+\. C, .+\. D, .+\.$/);
  d.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'b',bubbles:true}));for(let i=0;i<40&&!d.querySelector('.next-question');i++)await wait(5);await wait(10);
  assert.equal(btns[1].getAttribute('aria-disabled'),'true');assert(/your answer/.test(btns[1].getAttribute('aria-label')),'pressing B chose option B');
  assert.match($('#answer-feedback').textContent,/^(Correct! The answer is B: |Incorrect\. You chose B: .+ The correct answer is [ACD]: )/);
  globalThis.setTimeout=fast;
  console.log('ok 16 options labelled A-D ("Option B: …"), progress spoken once, repeat reads the options, A-D keys choose');
}
// Legal pages
for(const p of ['privacy-policy.html','terms-and-conditions.html']){const d=new JSDOM(readFileSync(ROOT+p,'utf8')).window.document;assert.equal(d.querySelectorAll('h1').length,1);assert(d.querySelector('main#main')&&d.documentElement.lang==='en');assert(d.querySelector('a[href="./"]'));for(const a of d.querySelectorAll('a'))assert(a.textContent.trim().length>2);console.log('ok legal',p,d.querySelectorAll('h2').length,'sections')}
process.exit(0);
