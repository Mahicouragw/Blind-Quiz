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
const json=(body:unknown,status=200,origin:string|null=null)=>new Response(JSON.stringify(body),{status,headers:{...cors(origin),'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
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
// Prefer headers set by the platform edge (clients cannot override cf-connecting-ip behind Cloudflare).
function ipOf(req:Request){return req.headers.get('cf-connecting-ip')??req.headers.get('x-real-ip')??req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown'}
async function consume(key:string,limit:number,window:number){const bucket=await digest(`${PEPPER}|${key}`);const {data,error}=await admin.rpc('bq_consume_attempt',{p_bucket:bucket,p_limit:limit,p_window_seconds:window});if(error)throw error;return data===true}
async function permit(req:Request,scope:string,identity:string,limit=8,window=900){return consume(`${scope}|${ipOf(req)}|${identity}`,limit,window)}
// IP-independent ceiling per account (or per action): rotating or spoofed IPs cannot multiply guesses against one account.
async function permitAccount(scope:string,identity:string,limit:number,window:number){return consume(`${scope}|account|${identity}`,limit,window)}
// Own-profile fields only (never hashes or salts). Username cooldown after the 1st/2nd/3rd/4th+ change: 7/14/30/60 days, as in bq_name_cooldown_days.
const PROFILE_COLS='id,display_name,login_id,secret_question,name_change_count,name_changed_at,xp,coins,level,current_streak,best_streak,questions_answered,questions_correct,quizzes_completed';
const cooldownDays=(n:number)=>n<=0?0:n===1?7:n===2?14:n===3?30:60;
async function session(req:Request){const token=(req.headers.get('authorization')??'').replace(/^Bearer\s+/i,'').trim();if(token.length<35)return null;const tokenHash=await digest(token);const {data,error}=await admin.from('bq_sessions').select(`id,profile_id,expires_at,revoked_at,bq_profiles(${PROFILE_COLS})`).eq('token_hash',tokenHash).gt('expires_at',new Date().toISOString()).is('revoked_at',null).maybeSingle();if(error||!data)return null;return {row:data,profile:Array.isArray(data.bq_profiles)?data.bq_profiles[0]:data.bq_profiles}}
function publicProfile(p:any){const changes=p.name_change_count??0;return {name:p.display_name,loginId:p.login_id,secretQuestion:p.secret_question,nameChangeCount:changes,nextNameChangeAt:p.name_changed_at?new Date(Date.parse(p.name_changed_at)+cooldownDays(changes)*86400000).toISOString():null,xp:p.xp,coins:p.coins,level:p.level,currentStreak:p.current_streak,bestStreak:p.best_streak,questionsAnswered:p.questions_answered,questionsCorrect:p.questions_correct,quizzesCompleted:p.quizzes_completed}}
// Admin = a row in bq_admins (Migration 017: the owner's Goldfish account). Missing table or row means not an admin.
async function isAdmin(profileId:string){const {data,error}=await admin.from('bq_admins').select('profile_id').eq('profile_id',profileId).maybeSingle();return !error&&!!data}
const nameArg=(b:any)=>{const n=normalize(clean(b.name,40));return n.length>=2?{p_name_normalized:n}:null};
const text=(v:unknown,min:number,max:number)=>{const t=typeof v==='string'?v.normalize('NFKC').trim():'';return t.length>=min&&t.length<=max?t:null};
const SOCIAL_CODES=['player_unavailable','too_many_requests','request_unavailable','forbidden','invalid_request','not_friends','device_unknown','keys_changed'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Encrypted messages: the server only checks the shape and size of the sealed boxes; it cannot read them.
const boxesArg=(b:any)=>{const n=nameArg(b),d=String(b.deviceId??''),x=b.boxes;if(!n||!UUID.test(d)||!x||typeof x!=='object'||Array.isArray(x))return null;const k=Object.keys(x);if(!k.length||k.length>8||JSON.stringify(x).length>24000||!k.every(id=>UUID.test(id)&&['s','iv','ct'].every(f=>typeof x[id]?.[f]==='string')))return null;return {...n,p_sender_device:d,p_boxes:x}};
const SOCIAL:Record<string,[string,(b:any)=>Record<string,unknown>|null,number,boolean?]>={
 'touch':['bq_touch',()=>({}),400],'notifications':['bq_notifications_list',()=>({}),400],'my-feedback':['bq_my_feedback',()=>({}),200],
 'notifications-read':['bq_notifications_read',b=>({p_ids:Array.isArray(b.ids)?b.ids.map(Number).filter((n:number)=>Number.isSafeInteger(n)&&n>0).slice(0,100):null}),300],
 'set-notifications':['bq_set_notifications',b=>typeof b.enabled==='boolean'?{p_enabled:b.enabled}:null,60],
 'online-players':['bq_online_players',()=>({}),400],'friends':['bq_friends',()=>({}),400],'player-card':['bq_player_card',nameArg,400],
 'friend-request':['bq_friend_request',nameArg,60],'friend-remove':['bq_friend_remove',nameArg,60],
 'friend-respond':['bq_friend_respond',b=>{const n=nameArg(b);return n&&typeof b.accept==='boolean'?{...n,p_accept:b.accept}:null},120],
 'admin-feedback-reply':['bq_feedback_reply',b=>{const r=text(b.reply,1,2000),id=Number(b.id);return r&&Number.isSafeInteger(id)&&id>0?{p_feedback_id:id,p_reply:r}:null},200,true],
 'register-device':['bq_register_device',b=>UUID.test(String(b.deviceId??''))&&/^[A-Za-z0-9+/]{87}=$/.test(String(b.publicKey??''))?{p_device_id:b.deviceId,p_public_key:b.publicKey}:null,60],
 'message-keys':['bq_message_keys',nameArg,600],'send-message':['bq_send_message',boxesArg,300],'conversations':['bq_conversations',()=>({}),400],
 'messages':['bq_messages_with',b=>{const n=nameArg(b),a=b.afterId==null?null:Number(b.afterId);return n&&UUID.test(String(b.deviceId??''))&&(a===null||(Number.isSafeInteger(a)&&a>=0))?{...n,p_device_id:b.deviceId,p_after_id:a}:null},1200],
 'admin-announce':['bq_announce',b=>{const t=text(b.text,3,500);return t?{p_body:t}:null},10,true],
};
const SCREENSHOT=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
async function handler(req:Request){
 const origin=req.headers.get('origin');if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});if(req.method!=='POST')return json({ok:false,code:'method_not_allowed'},405,origin);if(origin&&!ALLOWED_ORIGINS.has(origin))return json({ok:false,code:'origin_not_allowed'},403,origin);
 const key=req.headers.get('apikey')??'';if(!key.startsWith('sb_publishable_'))return json({ok:false,code:'unauthorized'},401,origin);
 let body:any;try{body=await req.json()}catch{return json({ok:false,code:'invalid_request'},400,origin)}
 try{
  if(body.action==='signup'){
   const name=clean(body.name,40),question=clean(body.question,120),answer=clean(body.answer,120),normalized=normalize(name);
   if(name.length<2||normalized.length<2||question.length<8||answer.length<2)return json({ok:false,code:'invalid_request'},400,origin);
   if(!await permit(req,'signup',normalized,6,3600)||!await permitAccount('signup','all',300,3600))return json({ok:false,code:'rate_limited'},429,origin);
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
   if(!await permit(req,'name-check','',60,3600)||!await permitAccount('name-check','all',3000,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const {data}=await admin.from('bq_profiles').select('id').eq('name_normalized',normalized).maybeSingle();return json({ok:true,available:!data},200,origin);
  }
  if(body.action==='secret-question'){
   const name=normalize(clean(body.name,40)),loginId=clean(body.loginId,8).toUpperCase();if(name.length<2||loginId.length!==8)return json({ok:false,code:'invalid_request'},400,origin);
   if(!await permit(req,'question',`${name}:${loginId}`,10,900)||!await permitAccount('question',`${name}:${loginId}`,30,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const {data}=await admin.from('bq_profiles').select('secret_question').eq('name_normalized',name).eq('login_id',loginId).maybeSingle();if(!data)return json({ok:false,code:'invalid_credentials'},404,origin);return json({ok:true,question:data.secret_question},200,origin);
  }
  if(body.action==='recover-id'){
   const name=normalize(clean(body.name,40)),question=clean(body.question,120),answer=clean(body.answer,120);if(name.length<2||question.length<8||answer.length<2)return json({ok:false,code:'invalid_recovery'},400,origin);
   if(!await permit(req,'recover',name,5,3600)||!await permitAccount('recover',name,10,86400))return json({ok:false,code:'rate_limited'},429,origin);
   const {data:p}=await admin.from('bq_profiles').select('login_id,secret_question,answer_salt,answer_hash').eq('name_normalized',name).maybeSingle();const candidate=await answerHash(answer,p?.answer_salt??'00000000000000000000000000000000');if(!p||normalize(p.secret_question)!==normalize(question)||!constantTimeEqual(candidate,p.answer_hash))return json({ok:false,code:'invalid_recovery'},401,origin);return json({ok:true,loginId:p.login_id},200,origin);
  }
  if(body.action==='login'){
   const name=clean(body.name,40),normalized=normalize(name),loginId=clean(body.loginId,8).toUpperCase(),answer=clean(body.answer,120);if(normalized.length<2||loginId.length!==8||answer.length<2)return json({ok:false,code:'invalid_credentials'},401,origin);
   if(!await permit(req,'login',`${normalized}:${loginId}`,7,900)||!await permitAccount('login',`${normalized}:${loginId}`,20,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const {data:p}=await admin.from('bq_profiles').select(`${PROFILE_COLS},last_login_at,answer_salt,answer_hash`).eq('name_normalized',normalized).eq('login_id',loginId).maybeSingle();
   const candidate=await answerHash(answer,p?.answer_salt??'00000000000000000000000000000000');if(!p||!constantTimeEqual(candidate,p.answer_hash))return json({ok:false,code:'invalid_credentials'},401,origin);
   const firstLogin=!p.last_login_at,nowIso=new Date().toISOString();await admin.from('bq_sessions').delete().eq('profile_id',p.id).or(`expires_at.lt.${nowIso},revoked_at.not.is.null`);await admin.from('bq_profiles').update({last_login_at:new Date().toISOString()}).eq('id',p.id);const raw=tokenText(randomBytes(32)),tokenHash=await digest(raw),expiresAt=new Date(Date.now()+7*86400000).toISOString();const {error}=await admin.from('bq_sessions').insert({profile_id:p.id,token_hash:tokenHash,expires_at:expiresAt});if(error){console.error('Session create failed',error.code);return json({ok:false,code:'service_error'},500,origin)}return json({ok:true,firstLogin,token:raw,expiresAt,profile:{...publicProfile(p),isAdmin:await isAdmin(p.id)}},200,origin);
  }
  const auth=await session(req);if(!auth)return json({ok:false,code:'session_expired'},401,origin);const profileId=auth.profile.id;
  if(body.action==='logout'){await admin.from('bq_sessions').update({revoked_at:new Date().toISOString()}).eq('id',auth.row.id);return json({ok:true},200,origin)}
  if(body.action==='profile')return json({ok:true,profile:{...publicProfile(auth.profile),isAdmin:await isAdmin(profileId)}},200,origin);
  if(body.action==='record-answer'){
   const questionId=clean(body.questionId,100),choice=clean(body.choice,250);if(!questionId||!choice)return json({ok:false,code:'invalid_request'},400,origin);if(!await permit(req,'answer',profileId,180,86400))return json({ok:false,code:'rate_limited'},429,origin);
   const {data,error}=await admin.rpc('bq_record_answer',{p_profile_id:profileId,p_question_id:questionId,p_choice:choice});if(error){console.error('Answer record failed',error.code);return json({ok:false,code:'service_error'},503,origin)}return json({ok:true,...data},200,origin);
  }
  // Own profile only: the profile id always comes from the session, never from the request body. The current secret answer is required.
  if(body.action==='update-profile'){
   if(!await permitAccount('profile-change',profileId,6,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const current=clean(body.currentAnswer,120),name=clean(body.name,40),question=clean(body.question,120),answer=clean(body.answer,120);
   if(current.length<2||(!name&&!answer)||(name&&normalize(name).length<2)||(question&&(question.length<8||!answer))||(answer&&answer.length<2))return json({ok:false,code:'invalid_request'},400,origin);
   const {data:p}=await admin.from('bq_profiles').select('display_name,answer_salt,answer_hash').eq('id',profileId).single();
   if(!p||!constantTimeEqual(await answerHash(current,p.answer_salt),p.answer_hash))return json({ok:false,code:'wrong_answer'},403,origin);
   const changed:string[]=[];
   if(name&&name!==p.display_name){const {data:r,error}=await admin.rpc('bq_change_name',{p_profile_id:profileId,p_name:name,p_normalized:normalize(name)});if(error){console.error('Name change failed',error.code);return json({ok:false,code:'service_error'},503,origin)}
    if(r?.code==='name_taken')return json({ok:false,code:'name_taken'},409,origin);if(r?.code==='name_cooldown')return json({ok:false,code:'name_cooldown',nextChangeAt:r.nextChangeAt},409,origin);if(r?.code!=='ok'&&r?.code!=='unchanged')return json({ok:false,code:'invalid_request'},400,origin);if(r.code==='ok')changed.push('name')}
   if(answer){const saltHex=hex(randomBytes(16)),update:any={answer_salt:saltHex,answer_hash:await answerHash(answer,saltHex),updated_at:new Date().toISOString()};if(question)update.secret_question=question;const {error}=await admin.from('bq_profiles').update(update).eq('id',profileId);if(error){console.error('Secret update failed',error.code);return json({ok:false,code:'service_error'},503,origin)}
    if(question)changed.push('question');changed.push('answer');await admin.from('bq_sessions').update({revoked_at:new Date().toISOString()}).eq('profile_id',profileId).neq('id',auth.row.id).is('revoked_at',null)}
   const {data:fresh}=await admin.from('bq_profiles').select(PROFILE_COLS).eq('id',profileId).single();return json({ok:true,changed,profile:publicProfile(fresh)},200,origin);
  }
  // Letters to Words: the word must use only the puzzle letters; bq_record_word checks the dictionary and pays XP/coins on the first find only.
  if(body.action==='record-word'){
   const word=clean(body.word,20).toLowerCase(),letters=clean(body.letters,20).toLowerCase();if(!/^[a-z]{2,7}$/.test(word)||!/^[a-z]{4,9}$/.test(letters))return json({ok:false,code:'invalid_request'},400,origin);
   const pool=[...letters];for(const ch of word){const i=pool.indexOf(ch);if(i<0)return json({ok:false,code:'invalid_word'},400,origin);pool.splice(i,1)}
   if(!await permitAccount('word',profileId,400,86400))return json({ok:false,code:'rate_limited'},429,origin);
   const {data,error}=await admin.rpc('bq_record_word',{p_profile_id:profileId,p_word:word});if(error){console.error('Word record failed',error.code);return json({ok:false,code:'service_error'},503,origin)}
   if(!data?.valid)return json({ok:true,valid:false,xp:0,coins:0},200,origin);return json({ok:true,valid:true,alreadyFound:data.alreadyFound,xp:data.xp,coins:data.coins,profile:{...publicProfile(auth.profile),...data.profile}},200,origin);
  }
  // Settings > Send feedback: the typed name must be the signed-in account's own name; the screenshot is an optional image data URL.
  if(body.action==='submit-feedback'){
   const name=clean(body.name,40),kind=clean(body.kind,10),message=typeof body.message==='string'?body.message.normalize('NFKC').trim().slice(0,2000):'',shot=typeof body.screenshot==='string'&&body.screenshot?body.screenshot:null;
   if(!['feedback','problem','idea'].includes(kind)||message.length<5||(shot&&(shot.length>900000||!SCREENSHOT.test(shot))))return json({ok:false,code:'invalid_request'},400,origin);
   if(normalize(name)!==normalize(auth.profile.display_name))return json({ok:false,code:'name_mismatch'},403,origin);
   if(!await permitAccount('feedback',profileId,8,86400))return json({ok:false,code:'rate_limited'},429,origin);
   const {error}=await admin.from('bq_feedback').insert({profile_id:profileId,name:auth.profile.display_name,kind,message,screenshot:shot});if(error){console.error('Feedback save failed',error.code);return json({ok:false,code:'service_error'},503,origin)}return json({ok:true},201,origin);
  }
  // Admin feedback inbox: list without screenshots; opening one item returns its screenshot and marks it read.
  if(body.action==='feedback-inbox'||body.action==='feedback-item'){
   if(!await isAdmin(profileId))return json({ok:false,code:'forbidden'},403,origin);
   if(body.action==='feedback-inbox'){const {data,error}=await admin.from('bq_feedback').select('id,name,kind,message,has_screenshot,created_at,read_at,reply,replied_at').order('created_at',{ascending:false}).limit(200);if(error){console.error('Feedback inbox failed',error.code);return json({ok:false,code:'service_error'},503,origin)}
    return json({ok:true,unread:data.filter((f:any)=>!f.read_at).length,items:data.map((f:any)=>({id:f.id,name:f.name,kind:f.kind,message:f.message,hasScreenshot:f.has_screenshot,createdAt:f.created_at,read:!!f.read_at,reply:f.reply??null,repliedAt:f.replied_at??null}))},200,origin)}
   const id=Number(body.id);if(!Number.isSafeInteger(id)||id<1)return json({ok:false,code:'invalid_request'},400,origin);
   const {data,error}=await admin.from('bq_feedback').update({read_at:new Date().toISOString()}).eq('id',id).select('id,screenshot').maybeSingle();if(error){console.error('Feedback item failed',error.code);return json({ok:false,code:'service_error'},503,origin)}if(!data)return json({ok:false,code:'invalid_request'},404,origin);
   return json({ok:true,id:data.id,screenshot:data.screenshot},200,origin);
  }
  // Sound Match (Migration 018): the board registers a game; finishing pays once, with time, tries and daily limits checked in bq_finish_sound_match.
  if(body.action==='soundmatch-start'){
   const level=clean(body.level,10);if(!['easy','medium','hard'].includes(level))return json({ok:false,code:'invalid_request'},400,origin);
   if(!await permitAccount('soundmatch-start',profileId,300,86400))return json({ok:false,code:'rate_limited'},429,origin);
   const {data,error}=await admin.rpc('bq_start_sound_match',{p_profile_id:profileId,p_level:level});if(error||!data?.ok){console.error('Sound Match start failed',error?.code);return json({ok:false,code:'service_error'},503,origin)}return json({ok:true,gameId:data.gameId},200,origin);
  }
  if(body.action==='soundmatch-finish'){
   const gameId=clean(body.gameId,40),tries=Number(body.tries);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId)||!Number.isSafeInteger(tries))return json({ok:false,code:'invalid_request'},400,origin);
   if(!await permitAccount('soundmatch-finish',profileId,300,86400))return json({ok:false,code:'rate_limited'},429,origin);
   const {data,error}=await admin.rpc('bq_finish_sound_match',{p_profile_id:profileId,p_game_id:gameId,p_tries:tries});if(error){console.error('Sound Match finish failed',error.code);return json({ok:false,code:'service_error'},503,origin)}
   if(!data?.ok)return json({ok:false,code:['too_fast','already_finished','invalid_tries','game_expired','game_unavailable'].includes(data?.code)?data.code:'invalid_request'},409,origin);
   return json({ok:true,stars:data.stars,xp:data.xp,coins:data.coins,dailyLimit:data.dailyLimit,profile:{...publicProfile(auth.profile),...data.profile}},200,origin);
  }
  // Social (Migration 019+): one row per action = [database function, argument check (null = invalid), hourly limit per account, admin-only].
  // The caller's profile id always comes from the session; other players are addressed by display name only.
  const social=SOCIAL[body.action];
  if(social){
   const [fn,argsOf,limit,adminOnly]=social,args=argsOf(body);if(!args)return json({ok:false,code:'invalid_request'},400,origin);
   if(adminOnly&&!await isAdmin(profileId))return json({ok:false,code:'forbidden'},403,origin);
   if(!await permitAccount(`social-${body.action}`,profileId,limit,3600))return json({ok:false,code:'rate_limited'},429,origin);
   const {data,error}=await admin.rpc(fn,{[adminOnly?'p_admin_id':'p_profile_id']:profileId,...args});if(error){console.error('Social action failed',body.action,error.code);return json({ok:false,code:'service_error'},503,origin)}
   if(Array.isArray(data))return json({ok:true,items:data},200,origin);
   if(data?.ok===false)return json({ok:false,code:SOCIAL_CODES.includes(data.code)?data.code:'invalid_request'},data.code==='forbidden'?403:409,origin);
   return json({...data,ok:true},200,origin);
  }
  if(body.action==='submit-report'){
   const questionId=clean(body.questionId,100),reason=clean(body.reason,20),details=clean(body.details,500);if(!questionId||!['incorrect','ambiguous','language','duplicate','inappropriate','other'].includes(reason))return json({ok:false,code:'invalid_request'},400,origin);if(!await permitAccount('report',profileId,20,86400))return json({ok:false,code:'rate_limited'},429,origin);const {error}=await admin.from('bq_question_reports').insert({profile_id:profileId,question_id:questionId,reason,details});if(error)return json({ok:false,code:error.code==='23503'?'invalid_request':'service_error'},error.code==='23503'?400:503,origin);return json({ok:true},201,origin);
  }
  return json({ok:false,code:'unknown_action'},400,origin);
 }catch(err){console.error('Blind Quiz API request failed.');return json({ok:false,code:'service_error'},500,origin)}
}
Deno.serve(handler);
