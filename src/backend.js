import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
const API = `${SUPABASE_URL}/functions/v1/blind-quiz-api`;
const SESSION_KEY = 'blindquiz.session.v1';
export function getSession(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
export function setSession(value){if(value)sessionStorage.setItem(SESSION_KEY,JSON.stringify(value));else sessionStorage.removeItem(SESSION_KEY)}
export async function callApi(action,payload={}){
 const session=getSession();
 const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_PUBLISHABLE_KEY,...(session?.token?{Authorization:`Bearer ${session.token}`}:{})},body:JSON.stringify({action,...payload})});
 let data={};try{data=await res.json()}catch{}
 if(!res.ok||data.ok===false)throw new Error(data.code||'request_failed');return data;
}
export async function checkBackend(){try{const r=await fetch(`${SUPABASE_URL}/auth/v1/settings`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY}});return r.ok}catch{return false}}
