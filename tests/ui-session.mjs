// Behavioural UI test (jsdom): session restore after reload, expiry, offline, friendly errors, storage hygiene,
// legal links. Run: npm i --no-save jsdom@24 && node tests/ui-session.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const html=readFileSync(ROOT+'index.html','utf8').replace(/<script[^>]*><\/script>/g,'');
let n=0;
const WINDOWS=[]; // src/audio.js is loaded once, so its cached audio elements may belong to an earlier window
async function boot({session,fetchImpl,local}){
  const dom=new JSDOM(html,{url:'https://mahicouragw.github.io/Blind-Quiz/',pretendToBeVisual:true});
  const w=dom.window;WINDOWS.push(w);
  for(const k of ['window','document','localStorage','sessionStorage','navigator','getSelection','HTMLElement','Node','history','location','Audio','HTMLMediaElement'])Object.defineProperty(globalThis,k,{value:w[k],configurable:true,writable:true});
  w.scrollTo=()=>{};globalThis.scrollTo=()=>{};
  for(const [k,v] of Object.entries(local||{}))w.localStorage.setItem(k,JSON.stringify(v));
  if(session)w.sessionStorage.setItem('blindquiz.session.v1',JSON.stringify(session));
  // Presence heartbeats (Task 19 'touch') are recorded separately so older tests keep checking their own calls.
  const calls=[],beats=[];globalThis.fetch=async(url,init)=>{if(init?.body){const a=JSON.parse(init.body).action;(a==='touch'?beats:calls).push(a)}return fetchImpl(url,init)};
  await import(ROOT+'src/main.js?'+(++n));
  await new Promise(r=>setTimeout(r,200));
  return {w,d:w.document,calls,beats};
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
{const footer=t.d.querySelector('footer');assert(!footer.querySelector('a[href*="privacy"],a[href*="terms"]'),'no legal links in the footer during play');const cb=t.d.querySelector('#copy-email');t.w.navigator.clipboard={writeText:async()=>{}};cb.click();await new Promise(r=>setTimeout(r,5));assert.equal(t.d.querySelector('#copy-email-status').textContent,'Email address copied: numbersareplaying@gmail.com')}
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
  assert.equal(cats.length,25);for(const c of ['medical','math','physics','chemistry','biology'])assert(cats.includes(c),`${c} category listed`);
  for(const c of cats){d.querySelector('#view-results [data-go="home"]')?.click();go:{d.querySelector(`#category-list [data-category="${c}"]`).click()}await wait(5);assert.equal(d.querySelector('#view-game').hidden,false,`${c} opens`);await play()}
  for(const m of [...d.querySelectorAll('#mode-list [data-mode]')].map(b=>b.dataset.mode).filter(m=>m!=='letters')){d.querySelector('#view-results [data-go="home"]').click();await wait(5);d.querySelector(`#mode-list [data-mode="${m}"]`).click();await wait(5);await play()}
  d.querySelector('#play-again').click();await wait(5);await play();
  // Leave during the countdown, then start a different game straight away.
  d.querySelector('#view-results [data-go="home"]').click();await wait(5);
  d.querySelector('#category-list [data-category="business"]').click();await wait(5);d.querySelector('#game-start').click();await wait(3);
  d.querySelector('#view-game .back-link').click();await wait(5);assert.equal(d.querySelector('#exit-confirm').hidden,false,'leaving a game asks first');d.querySelector('#exit-leave').click();await wait(5);
  d.querySelector('#category-list [data-category="history"]').click();await wait(5);
  assert.match(d.querySelector('#round-label').textContent,/HISTORY/);await play();
  // Leave mid-question with a timer running: nothing fires later and the next game opens.
  d.querySelector('#view-results [data-go="home"]').click();await wait(5);
  d.querySelector('#mode-list [data-mode="rapid"]').click();await wait(5);d.querySelector('#game-start').click();for(let i=0;i<100&&!d.querySelector('.answer-button');i++)await wait(5);
  d.querySelector('#view-game .back-link').click();await wait(5);
  // Task 19: exit confirmation. "No, keep playing" stays in the round; "Yes, exit" leaves.
  {const box=d.querySelector('#exit-confirm');assert.equal(box.hidden,false);assert.equal(d.querySelector('#exit-title').textContent,'Exit this quiz?');assert.match(d.querySelector('#exit-text').textContent,/Are you sure you want to exit\?/);
   assert.equal(d.activeElement.id,'exit-stay','focus starts on the safe choice');assert.equal(box.querySelector('[role="alertdialog"]').getAttribute('aria-modal'),'true');
   d.querySelector('#exit-stay').click();await wait(5);assert.equal(box.hidden,true);assert.equal(d.querySelector('#view-game').hidden,false,'Stay keeps the round');
   d.querySelector('#view-game .back-link').click();await wait(5);d.querySelector('#exit-leave').click();}
  await wait(60);assert.equal(d.querySelector('#view-home').hidden,false,'timer does not drag the player back');
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
  const played=[];t.w.HTMLMediaElement.prototype.play=function(){played.push(this.src.split('/').pop().split('?')[0]);return Promise.resolve()};t.w.HTMLMediaElement.prototype.pause=function(){};
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
    if(String(u).includes('/assets/meanings/'))return json(200,JSON.parse(readFileSync(ROOT+'assets/meanings/'+String(u).split('/').pop(),'utf8')));
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
  {const file=JSON.parse(readFileSync(ROOT+'assets/meanings/'+w1[0]+'.json','utf8'));const e=file[w1];const mean=Array.isArray(e)?e[0]:e;const esc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   assert.match($('#letters-status').textContent,new RegExp(`^Word found: ${w1.toUpperCase()}\\. Meaning${Array.isArray(e)?` \\(from ${e[1].toUpperCase()}\\)`:''}: ${esc(mean)}\\.? You earned ${w1.length-1} XP and 1 coin\\. Streak: 6\\.`),'spoken message includes the meaning: '+$('#letters-status').textContent);
   assert.equal($('#letters-meaning').hidden,false);assert.equal($('#letters-meaning strong').textContent,w1.toUpperCase());assert($('#letters-meaning span').textContent.endsWith(mean),'meaning card shows the meaning');
   assert(!/profile XP|earlier game/.test(d.body.textContent),'no profile XP or earlier-game wording')}
  assert.deepEqual(words[0],{action:'record-word',letters:words[0].letters,word:w1});assert.equal([...words[0].letters].sort().join(''),letters().sort().join(''));
  assert([...d.querySelectorAll('#letters-found li')].some(li=>li.textContent===w1.toUpperCase()),'found list');
  assert.equal($('#top-meta').textContent,'Signed in as goldfish');
  for(const w of targets.slice(1))await spellWord(w);
  await wait(40);
  if(targets.length>=goal){for(let i=0;i<50&&d.activeElement!==$('#letters-status');i++)await wait(5);
    assert.match($('#letters-status').textContent,new RegExp(`Round complete! ${goal} words found\\. \\d+ level XP earned, including a 4 XP round bonus\\. You earned \\d+ XP and ${goal} coins this round\\. Level XP: \\d+ of 30\\. \\d+ more to reach Level 2\\. Next: Round 2\\. Your letters are`));
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
  d.querySelector('#view-letters [data-go="home"]').click();await wait(10);assert.equal(d.querySelector('#exit-title').textContent,'Exit Letters to Words?');d.querySelector('#exit-leave').click();await wait(10);d.querySelector('#category-list [data-category="business"]').click();await wait(10);assert.equal($('#view-game').hidden,false);
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
  const played=[];for(const w of WINDOWS){w.HTMLMediaElement.prototype.play=function(){played.push(String(this.src).split('/').pop().split('?')[0]);return Promise.resolve()};w.HTMLMediaElement.prototype.pause=function(){}}
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
    assert.match($('#letters-status').textContent,/Round complete! \d+ words found\. \d+ level XP earned, including a 4 XP round bonus\. Level up! You are now Level 2\. Next: Round 1\. Your letters are [A-Z](, [A-Z]){4}\. Find \d words\./);
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
{ // 18. Settings > Send feedback: name check, problem screenshot prompt, send; admin inbox for Goldfish only.
  const sent=[];const shot='data:image/jpeg;base64,/9j/AAAA';
  const items=[{id:7,name:'Asha',kind:'problem',message:'The timer froze.\nOn question 3.',hasScreenshot:true,createdAt:'2026-10-06T10:00:00Z',read:false},{id:6,name:'Ravi',kind:'idea',message:'More music please',hasScreenshot:false,createdAt:'2026-10-05T10:00:00Z',read:true}];
  const api=(admin)=>(url,init)=>{const b=JSON.parse(init.body);sent.push(b);if(b.action==='profile')return json(200,{ok:true,profile:{...profile,loginId:'ABCDEFGH',isAdmin:admin}});if(b.action==='submit-feedback')return json(201,{ok:true});if(b.action==='feedback-inbox')return json(200,{ok:true,unread:1,items});if(b.action==='feedback-item')return json(200,{ok:true,id:7,screenshot:shot});if(b.action==='admin-feedback-reply')return json(200,{ok:true});if(b.action==='admin-announce')return json(200,{ok:true,sent:364});if(b.action==='touch')return json(200,{ok:true,unread:0,notificationsEnabled:true});if(b.action==='my-feedback')return json(200,{ok:true,items:[]});return json(400,{ok:false,code:'invalid_request'})};
  let s=await boot({fetchImpl:()=>{throw new Error('no network expected')}});
  s.d.querySelector('#settings-open').click();await new Promise(r=>setTimeout(r,80));
  assert.equal(s.d.querySelector('#feedback-signin').hidden,false);assert.equal(s.d.querySelector('#feedback-name-form').hidden,true);assert.equal(s.d.querySelector('#admin-inbox-box').hidden,true);
  s=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile:{...profile,loginId:'ABCDEFGH'}},fetchImpl:api(false)});
  s.d.querySelector('#settings-open').click();await new Promise(r=>setTimeout(r,120));
  assert.equal(s.d.querySelector('#admin-inbox-box').hidden,true,'players never see the inbox');
  const nf=s.d.querySelector('#feedback-name-form'),ff=s.d.querySelector('#feedback-form'),st=s.d.querySelector('#feedback-status');
  assert.equal(nf.hidden,false);assert.equal(ff.hidden,true);
  s.d.querySelector('#feedback-name').value='Someone Else';nf.dispatchEvent(new s.w.Event('submit',{cancelable:true}));
  assert.match(st.textContent,/does not match your account/);assert.equal(ff.hidden,true,'a wrong name cannot continue');
  s.d.querySelector('#feedback-name').value='  asha ';nf.dispatchEvent(new s.w.Event('submit',{cancelable:true}));
  assert.equal(ff.hidden,false);assert.equal(nf.hidden,true);assert.match(st.textContent,/Name checked/);
  const prob=ff.querySelector('input[value="problem"]');prob.checked=true;prob.dispatchEvent(new s.w.Event('change',{bubbles:true}));
  assert.equal(s.d.querySelector('#feedback-shot-box').hidden,false);assert.match(s.d.querySelector('.feedback-shot-ask').textContent,/add a screenshot/);
  s.d.querySelector('#feedback-message').value='hi';ff.dispatchEvent(new s.w.Event('submit',{cancelable:true}));assert.match(st.textContent,/at least 5/);
  s.d.querySelector('#feedback-message').value='The timer froze on question 3.';ff.dispatchEvent(new s.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,80));
  const fb=sent.find(b=>b.action==='submit-feedback');assert.deepEqual({name:fb.name,kind:fb.kind,message:fb.message,shot:'screenshot' in fb},{name:'asha',kind:'problem',message:'The timer froze on question 3.',shot:false});
  assert.match(st.textContent,/Thank you! Your feedback was sent/);assert.equal(ff.hidden,true);assert.equal(nf.hidden,false);assert.equal(s.d.querySelector('#feedback-name').value,'','the name is asked again next time');
  // Admin (Goldfish) sees the inbox, opens it, and views a screenshot.
  sent.length=0;s=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile:{...profile,name:'Goldfish',loginId:'GOLDFISH'}},fetchImpl:api(true)});
  s.d.querySelector('#settings-open').click();await new Promise(r=>setTimeout(r,120));
  assert.equal(s.d.querySelector('#admin-inbox-box').hidden,false,'the admin sees the inbox entry');
  s.d.querySelector('#open-inbox').click();await new Promise(r=>setTimeout(r,120));
  assert.equal(s.d.querySelector('#view-inbox').hidden,false);const lis=s.d.querySelectorAll('#inbox-list li');assert.equal(lis.length,2);
  assert.equal(lis[0].querySelector('h2').textContent,'Problem report from Asha');assert.match(lis[0].querySelector('.inbox-meta').textContent,/New · Screenshot attached/);assert.equal(lis[0].querySelector('.inbox-message').textContent,'The timer froze.\nOn question 3.');
  assert.equal(s.d.querySelector('#inbox-summary').textContent,'2 messages, 1 new.');assert(!lis[1].querySelector(':scope > button'),'read items without a screenshot need no Show/Mark button');assert(lis[1].querySelector('.inbox-reply textarea'),'every item has a reply box');
  lis[0].querySelector('button').click();await new Promise(r=>setTimeout(r,80));
  const img=lis[0].querySelector('img.inbox-shot');assert(img&&img.getAttribute('src')===shot&&img.alt==='Screenshot sent by Asha');assert.equal(s.d.querySelector('#inbox-summary').textContent,'2 messages, 0 new.');
  assert.deepEqual(sent.find(b=>b.action==='feedback-item'),{action:'feedback-item',id:7});
  // Task 19: the admin replies (the player is notified) and sends an announcement.
  {const rf=lis[1].querySelector('.inbox-reply form');rf.querySelector('textarea').value='Thanks, fixed now.';rf.dispatchEvent(new s.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,80));
   const rep=sent.find(b=>b.action==='admin-feedback-reply');assert.equal(rep.reply,'Thanks, fixed now.');assert.match(lis[1].querySelector('.feedback-reply').textContent,/Your reply: Thanks, fixed now\./);
   const af=s.d.querySelector('#announce-form');s.d.querySelector('#announce-text').value='A new game was added: Sound Match';af.dispatchEvent(new s.w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,80));
   assert.deepEqual(sent.find(b=>b.action==='admin-announce'),{action:'admin-announce',text:'A new game was added: Sound Match'});}
  console.log('ok 18 feedback: sign-in required, name checked against the account, screenshot asked for problems, sent; Goldfish-only inbox with screenshots');
}
{ // 19. Sound Match screen (Easy): numbers 1-10, press plays a sound, match/miss feedback, finish with stars and best score.
  const dom=new JSDOM(html,{url:'https://mahicouragw.github.io/Blind-Quiz/',pretendToBeVisual:true});const w=dom.window,d=w.document;
  for(const k of ['window','document','localStorage'])Object.defineProperty(globalThis,k,{value:w[k],configurable:true,writable:true});
  const { createSoundMatch } = await import(ROOT+'src/sound-match-ui.js');
  const pool=[];for(const mood of ['funny','mysterious','cinematic','interesting'])for(let i=0;i<8;i++)pool.push({slot:`match_${mood}_${i}`,name:`${mood} sound ${i}`,mood});
  const played=[],sfx=[],said=[];let seed=11;const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
  const fakeAudio={addEventListener:(ev,fn)=>{if(ev==='ended')setTimeout(fn,1)}};
  const sm=createSoundMatch({$:(s)=>d.querySelector(s),announce:t=>said.push(t),matchSounds:async()=>pool,playMatchSound:async s=>{played.push(s);return fakeAudio},stopMatchSound:()=>{},playSfx:s=>sfx.push(s),rnd,wait:async()=>{}});
  sm.wire();await sm.start('easy');
  const cards=[...d.querySelectorAll('#sm-grid .sm-card')];assert.equal(cards.length,10);assert.deepEqual(cards.map(c=>c.textContent.trim()),['1','2','3','4','5','6','7','8','9','10']);
  assert.equal(cards[0].getAttribute('aria-label'),'Number 1');assert.match(d.querySelector('#sm-stats').textContent,/Pairs found: 0 of 5 · Tries: 0/);
  assert.match(d.querySelector('#sm-status').textContent,/Easy: Numbers 1 to 10, 5 pairs of sounds\. Press a number/);
  const board=sm.state.board,pairOf=n=>board.find(c=>c.number!==n&&c.sound.slot===board[n-1].sound.slot).number,other=n=>board.find(c=>c.sound.slot!==board[n-1].sound.slot).number;
  const tick=()=>new Promise(r=>setTimeout(r,20));
  cards[0].click();await tick();assert.equal(played.at(-1),board[0].sound.slot,'pressing 1 plays its sound');assert(cards[0].classList.contains('open'));assert.equal(cards[0].getAttribute('aria-label'),'Number 1, playing');
  const o=other(1);cards[o-1].click();await tick();await tick();
  assert.equal(played.at(-1),board[o-1].sound.slot);assert.match(d.querySelector('#sm-status').textContent,new RegExp(`Not a match\\. 1 and ${o} play different sounds\\.`));assert.equal(sfx.at(-1),'wrong');
  assert(!cards[0].classList.contains('open')&&!cards[o-1].classList.contains('open'),'both close after a miss');
  const p=pairOf(1);cards[0].click();await tick();cards[p-1].click();await tick();await tick();
  assert.match(d.querySelector('#sm-status').textContent,new RegExp(`Match! 1 and ${p} are both ${board[0].sound.name}\\.`));assert.equal(sfx.at(-1),'correct');
  assert(cards[0].classList.contains('matched'));assert.equal(cards[0].querySelector('.sm-name').textContent,board[0].sound.name);assert.equal(cards[0].getAttribute('aria-label'),`Number 1, found: ${board[0].sound.name}`);
  assert.match(d.querySelector('#sm-stats').textContent,/Pairs found: 1 of 5 · Tries: 2/);
  for(const c of board){if(sm.state.matched.has(c.number))continue;cards[c.number-1].click();await tick();cards[pairOf(c.number)-1].click();await tick();await tick()}
  assert.equal(d.querySelector('#sm-finish').hidden,false);assert.match(d.querySelector('#sm-finish-text').textContent,/You found all 5 pairs in 6 tries! 3 stars\. New best score!/);
  assert.equal(JSON.parse(w.localStorage.getItem('blindquiz.soundmatch.best.v1')).easy,6);assert(['cheer','applause'].includes(sfx.at(-1)));
  d.querySelector('[data-sm-level="hard"]').click();await tick();assert.equal(d.querySelectorAll('#sm-grid .sm-card').length,20);assert.equal(d.querySelector('[data-sm-level="hard"]').getAttribute('aria-pressed'),'true');
  d.querySelector('[data-sm-level="medium"]').click();await tick();assert.equal(d.querySelectorAll('#sm-grid .sm-card').length,16);assert.equal(d.querySelector('#sm-finish').hidden,true);
  // Signed in: the board registers a game, and finishing it pays the server-checked reward.
  const api=[];let sess={token:'t',profile:{name:'Asha',level:1,xp:95,coins:3}};const profs=[];
  const sm2=createSoundMatch({$:(s)=>d.querySelector(s),announce:()=>{},matchSounds:async()=>pool,playMatchSound:async()=>fakeAudio,stopMatchSound:()=>{},playSfx:s=>sfx.push(s),rnd,wait:async()=>{},
    callApi:async(action,body)=>{api.push({action,...body});if(action==='soundmatch-start')return {ok:true,gameId:'11111111-2222-4333-8444-555555555555'};return {ok:true,stars:3,xp:10,coins:1,profile:{name:'Asha',level:2,xp:105,coins:4}}},
    getSession:()=>sess,setSession:v=>{sess=v},onProfile:p=>profs.push(p)});
  await sm2.start('easy');assert.deepEqual(api[0],{action:'soundmatch-start',level:'easy'});
  const b2=sm2.state.board,pair2=n=>b2.find(c=>c.number!==n&&c.sound.slot===b2[n-1].sound.slot).number;const cards2=()=>[...d.querySelectorAll('#sm-grid .sm-card')];
  for(const c of b2){if(sm2.state.matched.has(c.number))continue;cards2()[c.number-1].click();await tick();cards2()[pair2(c.number)-1].click();await tick();await tick()}
  await tick();
  assert.deepEqual(api[1],{action:'soundmatch-finish',gameId:'11111111-2222-4333-8444-555555555555',tries:5});
  assert.match(d.querySelector('#sm-finish-text').textContent,/You found all 5 pairs in 5 tries! 3 stars\..* You earned 10 XP and 1 coin\. Level up! You are now Level 2\./);
  assert(!/profile XP|profile level/i.test(d.querySelector('#sm-finish-text').textContent));
  assert.equal(sess.profile.xp,105);assert.equal(profs.at(-1).level,2);assert(sfx.includes('coin'));
  console.log('ok 19 Sound Match: numbers 1-10 on Easy (16 Medium, 20 Hard), press plays its sound, match/miss spoken, found sounds named, stars and best score; signed-in players earn server-checked XP and coins');
}
// 20. Task 19: notifications bell, friend request Accept, Multiplayer online list, player card privacy and the friendship rule.
{
  const tick=()=>new Promise(r=>setTimeout(r,60));const sent=[];let rel='none';
  const card=()=>({ok:true,player:{name:'Bob',level:3,xp:240,coins:12,questionsAnswered:120,questionsCorrect:90,quizzesCompleted:11,bestStreak:4,wordsFound:3,soundMatchGames:0,memberSince:'2026-10',online:true,self:false,relation:rel}});
  const t20=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile},fetchImpl:(url,init)=>{const b=JSON.parse(init.body);sent.push(b);
    const r={profile:{ok:true,profile},touch:{ok:true,unread:2,notificationsEnabled:true},
      notifications:{ok:true,items:[{id:7,kind:'friend_request',actor:'Bob',createdAt:future,read:false,relation:'incoming'},{id:6,kind:'feedback_reply',actor:'Goldfish',body:'Fixed, thanks!',createdAt:future,read:false}]},
      'notifications-read':{ok:true,unread:0},'friend-respond':{ok:true,relation:'friends'},'online-players':{ok:true,items:[{name:'Bob',level:3,relation:'none'}]},
      'player-card':()=>card(),'friend-request':()=>(rel='outgoing',{ok:true,relation:'outgoing'}),'my-feedback':{ok:true,items:[{id:1,message:'It breaks',createdAt:future,status:'replied',reply:'Fixed, thanks!'}]}}[b.action];
    return json(200,(typeof r==='function'?r():r)||{ok:true});}});
  const {d}=t20;await tick();
  const bell=d.querySelector('#notif-open');assert.equal(bell.hidden,false);assert.equal(bell.getAttribute('aria-label'),'Notifications, 2 new');
  bell.click();await tick();await tick();
  assert.equal(d.querySelector('#view-notifications').hidden,false);
  const items=[...d.querySelectorAll('#notif-list .notif-item')];assert.equal(items.length,2);
  assert.match(items[0].textContent,/Bob sent you a friend request\./);assert.match(items[1].textContent,/replied to your feedback: Fixed, thanks!/);
  assert(sent.some(b=>b.action==='notifications-read'&&b.ids===null),'opening marks all read');assert.equal(bell.getAttribute('aria-label'),'Notifications, none new');
  [...items[0].querySelectorAll('button')].find(b=>b.textContent==='Accept Bob').click();await tick();
  assert.deepEqual(sent.find(b=>b.action==='friend-respond'),{action:'friend-respond',name:'Bob',accept:true});assert.match(items[0].textContent,/Accepted\./);
  // Multiplayer: online players, then a card with stats and achievements but no Login ID; not friends -> Add friend.
  rel='none';d.querySelector('#mp-open').click();await tick();await tick();
  assert.equal(d.querySelector('#view-multiplayer').hidden,false);const pb=d.querySelector('#mp-online-list .player-button');assert.match(pb.getAttribute('aria-label'),/^Bob, level 3/);
  pb.click();await tick();await tick();
  assert.equal(d.querySelector('#view-player').hidden,false);const pv=d.querySelector('#view-player').textContent;
  assert.match(pv,/Questions answered, 120/);assert.match(pv,/Correct answers, 90, 75 percent/);assert.match(pv,/Century/);assert.match(pv,/Finisher/);
  assert(!/Login ID|User ID|secret/i.test(d.querySelector('#player-stats').textContent),'no Login ID or secret on another player\'s card');
  assert.match(pv,/To send Bob a match, you need to be friends first\./);
  [...d.querySelectorAll('#player-actions button')].find(b=>/Add friend/.test(b.textContent)).click();await tick();await tick();
  assert.deepEqual(sent.find(b=>b.action==='friend-request'),{action:'friend-request',name:'Bob'});assert.match(d.querySelector('#player-actions').textContent,/Friend request sent/);
  // Settings: notifications switch and My feedback with the developer's reply.
  d.querySelector('#settings-open').click();await tick();await tick();
  assert.equal(d.querySelector('#notif-settings').hidden,false);assert.match(d.querySelector('#my-feedback-list').textContent,/Replied.*It breaks.*Reply from the developer: Fixed, thanks!/s);
  const sw=d.querySelector('#notif-on');sw.checked=false;sw.dispatchEvent(new t20.w.Event('change'));await tick();
  assert.deepEqual(sent.find(b=>b.action==='set-notifications'),{action:'set-notifications',enabled:false});
  console.log('ok 20 notifications bell, Accept/Reject friend requests, feedback replies, online players, private player card with achievements, friends-first matches, notification switch');
}
// 21. Task 19 stage C: encrypted chat UI with real WebCrypto against a relay that only stores sealed boxes.
{
  const tick=()=>new Promise(r=>setTimeout(r,80));
  const E=await import(ROOT+'src/e2ee.js');const {createChat}=await import(ROOT+'src/chat.js');
  const t21=await boot({session:{token:'x'.repeat(43),expiresAt:future,profile},fetchImpl:()=>json(200,{ok:true,profile})});const {d}=t21;
  const bob=await E.deviceKey(E.memoryStore(),'bob');let mine=null;const relay=[];let nextId=1;const said=[];let bobKeys=[bob];
  const callApi=async(action,b)=>{
    if(action==='register-device'){mine={deviceId:b.deviceId,publicKey:b.publicKey};return {ok:true}}
    if(action==='message-keys')return {ok:true,theirs:bobKeys.map(k=>({deviceId:k.deviceId,publicKey:k.publicKey})),mine:[mine]};
    if(action==='send-message'){assert(!JSON.stringify(b).includes('Hello Bob'),'the relay never sees the text');relay.push({id:nextId++,fromMe:true,createdAt:future,read:false,senderDevice:b.deviceId,senderKey:mine.publicKey,boxes:b.boxes});return {ok:true,id:nextId-1}}
    if(action==='messages')return {ok:true,relation:'friends',messages:relay.filter(m=>m.id>(b.afterId||0)).map(m=>({...m,box:m.boxes[b.deviceId]||null}))};
    throw new Error('unexpected '+action)};
  const views=[];const chat=createChat({$:s=>d.querySelector(s),announce:x=>said.push(x),callApi,getSession:()=>({loginId:'ABCDEFGH',profile}),go:v=>{views.push(v);d.querySelectorAll('.view').forEach(x=>x.hidden=x.id!==`view-${v}`)},currentView:()=>views.at(-1),store:E.memoryStore(),pinsStorage:t21.w.localStorage});
  // Bob already sent one message sealed for a device this browser does not have yet -> honest "other device" text.
  relay.push({id:nextId++,fromMe:false,createdAt:future,read:true,senderDevice:bob.deviceId,senderKey:bob.publicKey,boxes:{}});
  await chat.openChat('Bob');await tick();
  assert.equal(d.querySelector('#view-chat').hidden,false);assert.equal(d.querySelector('#chat-title').textContent,'Chat with Bob');
  assert.match(d.querySelector('#chat-safety').textContent,/^Safety code: (\d{5} ){5}\d{5}$/);
  assert.match(d.querySelector('#chat-log').textContent,/only be read on the other device/);
  d.querySelector('#chat-text').value='Hello Bob, ready for a match?';d.querySelector('#chat-form').dispatchEvent(new t21.w.Event('submit',{cancelable:true}));await tick();await tick();
  const sent=relay.at(-1);assert.deepEqual(Object.keys(sent.boxes).sort(),[bob.deviceId,mine.deviceId].sort(),'sealed for Bob and for this device');
  assert.equal((await E.open(sent.boxes[bob.deviceId],bob,mine.deviceId,mine.publicKey)).t,'Hello Bob, ready for a match?','Bob can open it');
  assert.match(d.querySelector('#chat-log').textContent,/You, .*Hello Bob, ready for a match\?/);
  // Bob replies; a second reply is tampered with on the server.
  const reply=await E.seal('Yes! Room Blind Quiz.',bob,[mine]);relay.push({id:nextId++,fromMe:false,createdAt:future,read:false,senderDevice:bob.deviceId,senderKey:bob.publicKey,boxes:reply});
  const bad=await E.seal('Send me your secret answer',bob,[mine]);const ct=E.unb64(bad[mine.deviceId].ct);ct[0]^=1;bad[mine.deviceId].ct=E.b64(ct);
  relay.push({id:nextId++,fromMe:false,createdAt:future,read:false,senderDevice:bob.deviceId,senderKey:bob.publicKey,boxes:bad});
  await new Promise(r=>setTimeout(r,4300));
  const logText=d.querySelector('#chat-log').textContent;assert.match(logText,/Bob, .*Yes! Room Blind Quiz\./);assert.match(logText,/could not be verified, so it is hidden/);assert(!logText.includes('Send me your secret answer'),'tampered text is never shown');
  assert(said.some(x=>x==='Bob says: Yes! Room Blind Quiz.'),'incoming messages are announced');
  // Bob reinstalls: a new key -> warning, sending blocked until the player confirms the safety code.
  const bobNew=await E.deviceKey(E.memoryStore(),'bob-new');bobKeys=[bobNew];await chat.openChat('Bob');await tick();
  assert.equal(d.querySelector('#chat-warning').hidden,false);assert.match(d.querySelector('#chat-warning-text').textContent,/security key changed/);
  const before=relay.length;d.querySelector('#chat-text').value='Is this really you?';d.querySelector('#chat-form').dispatchEvent(new t21.w.Event('submit',{cancelable:true}));await tick();
  assert.equal(relay.length,before,'nothing is sent before the new key is confirmed');
  d.querySelector('#chat-trust').click();d.querySelector('#chat-form').dispatchEvent(new t21.w.Event('submit',{cancelable:true}));await tick();await tick();
  assert.equal(relay.length,before+1);assert(relay.at(-1).boxes[bobNew.deviceId]&&!relay.at(-1).boxes[bob.deviceId],'sealed for the new key only');
  chat.stop();
  console.log('ok 21 encrypted chat: safety code, honest other-device notice, sealed for both devices, tampered message hidden, incoming announced, key change blocks sending until confirmed');
}
for(const p of ['privacy-policy.html','terms-and-conditions.html']){const d=new JSDOM(readFileSync(ROOT+p,'utf8')).window.document;assert.equal(d.querySelectorAll('h1').length,1);assert(d.querySelector('main#main')&&d.documentElement.lang==='en');assert(d.querySelector('a[href="./"]'));for(const a of d.querySelectorAll('a'))assert(a.textContent.trim().length>2);console.log('ok legal',p,d.querySelectorAll('h2').length,'sections')}
process.exit(0);
