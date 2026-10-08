import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
const API = `${SUPABASE_URL}/functions/v1/blind-quiz-api`;
// The session token lives only in sessionStorage: it survives a page reload in the same tab or app
// WebView, and is gone when the tab or app is closed. The server re-validates it on every call.
const SESSION_KEY = 'blindquiz.session.v1';
export function getSession(){try{const s=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');if(!s||typeof s.token!=='string')return null;if(s.expiresAt&&Date.parse(s.expiresAt)<=Date.now()){sessionStorage.removeItem(SESSION_KEY);return null}return s}catch{return null}}
export function setSession(value){try{if(value)sessionStorage.setItem(SESSION_KEY,JSON.stringify(value));else sessionStorage.removeItem(SESSION_KEY)}catch{}}
export async function callApi(action,payload={}){
 const session=getSession();
 let res;try{res=await fetch(API,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','apikey':SUPABASE_PUBLISHABLE_KEY,...(session?.token?{Authorization:`Bearer ${session.token}`}:{})},body:JSON.stringify({action,...payload})})}catch{throw new Error('network')}
 let data={};try{data=await res.json()}catch{}
 // A rejected session token (401 on an authenticated call) is discarded so the player is asked to sign in again.
 if(res.status===401&&session?.token&&!['login','signup','recover-id','secret-question','check-name'].includes(action))setSession(null);
 if(!res.ok||data.ok===false)throw new Error(data.code||'request_failed');return data;
}
