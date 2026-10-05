// Behavioural UI test (jsdom): session restore after reload, expiry, offline, friendly errors, storage hygiene,
// legal links. Run: npm i --no-save jsdom@24 && node tests/ui-session.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const html=readFileSync(ROOT+'index.html','utf8').replace(/<script[^>]*><\/script>/g,'');
let n=0;
async function boot({session,fetchImpl}){
  const dom=new JSDOM(html,{url:'https://mahicouragw.github.io/Blind-Quiz/',pretendToBeVisual:true});
  const w=dom.window;
  for(const k of ['window','document','localStorage','sessionStorage','navigator','getSelection','HTMLElement','Node'])Object.defineProperty(globalThis,k,{value:w[k],configurable:true,writable:true});
  w.scrollTo=()=>{};globalThis.scrollTo=()=>{};
  if(session)w.sessionStorage.setItem('blindquiz.session.v1',JSON.stringify(session));
  const calls=[];globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body).action);return fetchImpl(url,init)};
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
// Legal pages
for(const p of ['privacy-policy.html','terms-and-conditions.html']){const d=new JSDOM(readFileSync(ROOT+p,'utf8')).window.document;assert.equal(d.querySelectorAll('h1').length,1);assert(d.querySelector('main#main')&&d.documentElement.lang==='en');assert(d.querySelector('a[href="./"]'));for(const a of d.querySelectorAll('a'))assert(a.textContent.trim().length>2);console.log('ok legal',p,d.querySelectorAll('h2').length,'sections')}
process.exit(0);
