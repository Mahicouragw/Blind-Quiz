import { createClient } from 'npm:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? (() => {
  try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default; } catch { return ''; }
})();
const PEPPER = Deno.env.get('BQ_RATE_LIMIT_PEPPER') ?? SECRET;
if (!URL || !SECRET || !PEPPER) console.error('Blind Quiz server configuration is incomplete.');
const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const ALLOWED_ORIGINS = new Set((Deno.env.get('BQ_ALLOWED_ORIGINS') ?? 'https://mahicouragw.github.io,http://localhost:4173,http://127.0.0.1:4173').split(',').map(x=>x.trim()).filter(Boolean));
const cors=(origin:string|null)=>({
  'Access-Control-Allow-Origin':origin&&ALLOWED_ORIGINS.has(origin)?origin:'null',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Vary':'Origin',
});
const json=(body:unknown,status=200,origin:string|null=null)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store'}});
const normalize=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
const clean=(s:unknown,max:number)=>typeof s==='string'?s.normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,max):'';
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const randomBytes=(n:number)=>crypto.getRandomValues(new Uint8Array(n));
const tokenText=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function digest(s:string){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))))}
async function answerHash(answer:string,saltHex:string){const salt=Uint8Array.from(saltHex.match(/.{2}/g)??[],b=>parseInt(b,16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(normalize(answer)),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},key,256);return hex(new Uint8Array(bits))}
function constantTimeEqual(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeLoginId(){let out='';while(out.length<8){for(const b of randomBytes(16)){if(b<alphabet.length*8){out+=alphabet[b%alphabet.length];if(out.length===8)break}}}return out}
function ipOf(req:Request){return req.headers.get('cf-connecting-ip')??req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown'}
async function permit(req:Request,scope:string,identity:string,limit=8,window=900){const bucket=await digest(`${PEPPER}|${scope}|${ipOf(req)}|${identity}`);const {data,error}=await admin.rpc('bq_consume_attempt',{p_bucket:bucket,p_limit:limit,p_window_seconds:window});if(error)throw error;return data===true}
async function session(req:Request){const token=(req.headers.get('authorization')??'').replace(/^Bearer\s+/i,'').trim();if(token.length<35)return null;const tokenHash=await digest(token);const {data,error}=await admin.from('bq_sessions').select('id,profile_id,expires_at,revoked_at,bq_profiles(id,display_name,xp,coins,level,current_streak,best_streak,questions_answered,questions_correct,quizzes_completed)').eq('token_hash',tokenHash).gt('expires_at',new Date().toISOString()).is('revoked_at',null).maybeSingle();if(error||!data)return null;return {row:data,profile:Array.isArray(data.bq_profiles)?data.bq_profiles[0]:data.bq_profiles}}
function publicProfile(p:any){return {name:p.display_name,xp:p.xp,coins:p.coins,level:p.level,currentStreak:p.current_streak,bestStreak:p.best_streak,questionsAnswered:p.questions_answered,questionsCorrect:p.questions_correct,quizzesCompleted:p.quizzes_completed}}
async function handler(req:Request){
 const origin=req.headers.get('origin');if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});if(req.method!=='POST')return json({ok:false,code:'method_not_allowed'},405,origin);if(origin&&!ALLOWED_ORIGINS.has(origin))return json({ok:false,code:'origin_not_allowed'},403,origin);
 const key=req.headers.get('apikey')??'';if(!key.startsWith('sb_publishable_'))return json({ok:false,code:'unauthorized'},401,origin);
 let body:any;try{body=await req.json()}catch{return json({ok:false,code:'invalid_request'},400,origin)}
 try{
  if(body.action==='signup'){
   const name=clean(body.name,40),question=clean(body.question,120),answer=clean(body.answer,120),normalized=normalize(name);
   if(name.length<2||normalized.length<2||question.length<8||answer.length<2)return json({ok:false,code:'invalid_request'},400,origin);
   if(!await permit(req,'signup',normalized,6,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const saltHex=hex(randomBytes(16)),hashed=await answerHash(answer,saltHex);
   for(let attempt=0;attempt<12;attempt++){
    const loginId=makeLoginId();const {data,error}=await admin.from('bq_profiles').insert({display_name:name,name_normalized:normalized,login_id:loginId,secret_question:question,answer_salt:saltHex,answer_hash:hashed}).select('id').single();
    if(!error){return json({ok:true,loginId},201,origin)}
    if(error.code==='23505'&&error.message?.includes('name_normalized'))return json({ok:false,code:'name_taken'},409,origin);
    if(error.code==='23505'&&error.message?.includes('login_id'))continue;
    console.error('Signup database operation failed',error.code);return json({ok:false,code:'service_error'},500,origin);
   }
   return json({ok:false,code:'service_error'},503,origin);
  }
  if(body.action==='check-name'){
   const normalized=normalize(clean(body.name,40));if(normalized.length<2)return json({ok:false,code:'invalid_request'},400,origin);
   if(!await permit(req,'name-check',normalized,20,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const {data}=await admin.from('bq_profiles').select('id').eq('name_normalized',normalized).maybeSingle();return json({ok:true,available:!data},200,origin);
  }
  if(body.action==='secret-question'){
   const name=normalize(clean(body.name,40)),loginId=clean(body.loginId,8).toUpperCase();if(name.length<2||loginId.length!==8)return json({ok:false,code:'invalid_request'},400,origin);
   if(!await permit(req,'question',`${name}:${loginId}`,10,900))return json({ok:false,code:'rate_limited'},429,origin);
   const {data}=await admin.from('bq_profiles').select('secret_question').eq('name_normalized',name).eq('login_id',loginId).maybeSingle();if(!data)return json({ok:false,code:'invalid_credentials'},404,origin);return json({ok:true,question:data.secret_question},200,origin);
  }
  if(body.action==='recover-id'){
   const name=normalize(clean(body.name,40)),question=clean(body.question,120),answer=clean(body.answer,120);if(name.length<2||question.length<8||answer.length<2)return json({ok:false,code:'invalid_recovery'},400,origin);
   if(!await permit(req,'recover',name,5,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const {data:p}=await admin.from('bq_profiles').select('login_id,secret_question,answer_salt,answer_hash').eq('name_normalized',name).maybeSingle();const candidate=await answerHash(answer,p?.answer_salt??'00000000000000000000000000000000');if(!p||normalize(p.secret_question)!==normalize(question)||!constantTimeEqual(candidate,p.answer_hash))return json({ok:false,code:'invalid_recovery'},401,origin);return json({ok:true,loginId:p.login_id},200,origin);
  }
  if(body.action==='login'){
   const name=clean(body.name,40),normalized=normalize(name),loginId=clean(body.loginId,8).toUpperCase(),answer=clean(body.answer,120);if(normalized.length<2||loginId.length!==8||answer.length<2)return json({ok:false,code:'invalid_credentials'},401,origin);
   if(!await permit(req,'login',`${normalized}:${loginId}`,7,900))return json({ok:false,code:'rate_limited'},429,origin);
   const {data:p}=await admin.from('bq_profiles').select('id,display_name,xp,coins,level,current_streak,best_streak,questions_answered,questions_correct,quizzes_completed,last_login_at,answer_salt,answer_hash').eq('name_normalized',normalized).eq('login_id',loginId).maybeSingle();
   const candidate=await answerHash(answer,p?.answer_salt??'00000000000000000000000000000000');if(!p||!constantTimeEqual(candidate,p.answer_hash))return json({ok:false,code:'invalid_credentials'},401,origin);
   const firstLogin=!p.last_login_at;await admin.from('bq_profiles').update({last_login_at:new Date().toISOString()}).eq('id',p.id);const raw=tokenText(randomBytes(32)),tokenHash=await digest(raw),expiresAt=new Date(Date.now()+7*86400000).toISOString();const {error}=await admin.from('bq_sessions').insert({profile_id:p.id,token_hash:tokenHash,expires_at:expiresAt});if(error){console.error('Session create failed',error.code);return json({ok:false,code:'service_error'},500,origin)}return json({ok:true,firstLogin,token:raw,expiresAt,profile:publicProfile(p)},200,origin);
  }
  const auth=await session(req);if(!auth)return json({ok:false,code:'session_expired'},401,origin);const profileId=auth.profile.id;
  if(body.action==='logout'){await admin.from('bq_sessions').update({revoked_at:new Date().toISOString()}).eq('id',auth.row.id);return json({ok:true},200,origin)}
  if(body.action==='profile')return json({ok:true,profile:publicProfile(auth.profile)},200,origin);
  if(body.action==='record-answer'){
   const questionId=clean(body.questionId,100),choice=clean(body.choice,250);if(!questionId||!choice)return json({ok:false,code:'invalid_request'},400,origin);if(!await permit(req,'answer',profileId,180,86400))return json({ok:false,code:'rate_limited'},429,origin);
   const {data,error}=await admin.rpc('bq_record_answer',{p_profile_id:profileId,p_question_id:questionId,p_choice:choice});if(error){console.error('Answer record failed',error.code);return json({ok:false,code:'service_error'},503,origin)}return json({ok:true,...data},200,origin);
  }
  if(body.action==='submit-report'){
   const questionId=clean(body.questionId,100),reason=clean(body.reason,20),details=clean(body.details,500);if(!questionId||!['incorrect','ambiguous','language','duplicate','inappropriate','other'].includes(reason))return json({ok:false,code:'invalid_request'},400,origin);const {error}=await admin.from('bq_question_reports').insert({profile_id:profileId,question_id:questionId,reason,details});if(error)return json({ok:false,code:'service_error'},503,origin);return json({ok:true},201,origin);
  }
  return json({ok:false,code:'unknown_action'},400,origin);
 }catch(err){console.error('Blind Quiz API request failed.');return json({ok:false,code:'service_error'},500,origin)}
}
Deno.serve(handler);
