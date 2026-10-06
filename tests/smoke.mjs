import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUESTION_BANK, CATEGORY_LIST, STARTER_QUESTION_COUNT, MIGRATION_009_COUNT, validateQuestionBank } from '../src/content.js';
import { shuffled } from '../src/random.js';

assert.deepEqual(validateQuestionBank(),[],'question pack validation');
assert.equal(STARTER_QUESTION_COUNT,73,'historical starter IDs stay stable');
assert.equal(QUESTION_BANK.length,1075,'73 starter plus 1002 expansion questions (252 in Migration 009, 200 in Migration 010, 200 in Migration 011, 100 in Migration 015, 250 in Migration 016)');
assert.equal(MIGRATION_009_COUNT,252,'Migration 009 keeps its 252 rows');
assert.equal(CATEGORY_LIST.length,25,'20 established categories plus Medical, Math, Physics, Chemistry and Biology');
const NEW_CATS=['medical','math','physics','chemistry','biology'];
assert.deepEqual(CATEGORY_LIST.slice(20).map(c=>c.id),NEW_CATS,'five new categories');
for(const c of CATEGORY_LIST.slice(20))assert.equal(c.count,30,`${c.id} has 30 questions (20 from Migration 015, 10 from Migration 016)`);
for(const category of CATEGORY_LIST.slice(0,20)){
  const added=QUESTION_BANK.slice(STARTER_QUESTION_COUNT,STARTER_QUESTION_COUNT+252).filter(q=>q.category===category.id);
  const expected=category.id==='braille'?24:12;
  assert.equal(added.length,expected,`${category.id} has ${expected} Migration 009 questions`);
}
assert.equal(QUESTION_BANK[73].id,'bq-en-0415','first safe expansion ID after the verified remote maximum');
assert.equal(QUESTION_BANK[324].id,'bq-en-0666','final Migration 009 ID');
assert.equal(QUESTION_BANK[325].id,'bq-en-0667','first Migration 010 ID');
assert.equal(QUESTION_BANK[524].id,'bq-en-0866','final Migration 010 ID');
assert.equal(QUESTION_BANK[525].id,'bq-en-0867','first Migration 011 ID');
assert.equal(QUESTION_BANK[724].id,'bq-en-1066','final Migration 011 ID');
assert.equal(QUESTION_BANK[725].id,'bq-en-1067','first Migration 015 ID');
assert.equal(QUESTION_BANK.at(-1).id,'bq-en-1416','final expansion ID (end of Migration 016)');
assert.equal(QUESTION_BANK.length-STARTER_QUESTION_COUNT,1002,'1002 expansion questions');
for(const category of CATEGORY_LIST.slice(0,20)){
  const added=QUESTION_BANK.slice(325,525).filter(q=>q.category===category.id);
  assert.equal(added.length,10,`${category.id} has 10 Migration 010 questions`);
  const added011=QUESTION_BANK.slice(525,725).filter(q=>q.category===category.id);
  assert.equal(added011.length,10,`${category.id} has 10 Migration 011 questions`);
}
const normPrompt=s=>s.toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
assert.equal(new Set(QUESTION_BANK.map(q=>normPrompt(q.question))).size,QUESTION_BANK.length,'no duplicate prompts across all 1075 questions');
const ids=new Set(QUESTION_BANK.map(q=>q.id));
assert.equal(ids.size,QUESTION_BANK.length,'unique stable question ids');
for(const q of QUESTION_BANK.slice(STARTER_QUESTION_COUNT))assert.match(q.sourceNote,/https:\/\//,`${q.id} source note`);

const source=['A','B','C','D'];
const deterministic=shuffled(source,max=>max-1);
assert.deepEqual(deterministic,source,'shuffle supports final index');
assert.notEqual(shuffled(source,()=>0),source,'shuffle can move the authored correct-first choice');
assert.deepEqual([...shuffled(source,()=>0)].sort(),source,'shuffle preserves every answer');

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
for(const id of ['home','auth','game','settings','results','announcer','assertive-announcer'])assert(html.includes(`id="${id.startsWith('announcer')?id:`view-${id}`}"`)||html.includes(`id="${id}"`),`required UI landmark ${id}`);
assert(html.includes('aria-live="polite"')&&html.includes('aria-live="assertive"'),'live regions');
assert(html.includes('id="recovery-form"')&&html.includes('Forgot Login ID?'),'login ID recovery UI');
assert(html.includes('Eight-character Login ID'),'Login ID field');
assert(!/<input[^>]*type="(?:email|password)"/i.test(html),'no email/password input fields');
assert(html.includes('id="sfx-on"')&&html.includes('id="music-on"')&&html.includes('id="music-volume"'),'sound effect and music controls');
const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
assert(css.includes(':focus-visible'),'visible focus indicator');
assert(css.includes('.high-contrast')&&css.includes('.large-text')&&css.includes('.reduce-motion'),'accessibility settings styles');
const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
assert(!/(AudioContext|createOscillator)/.test(main),'no synthetic Web Audio effects');
const audioSrc=await readFile(new URL('../src/audio.js',import.meta.url),'utf8');
assert(!/(AudioContext|createOscillator|speechSynthesis|OfflineAudio)/.test(audioSrc)&&audioSrc.includes('new Audio('),'recorded files only, played with HTML audio elements');
const audioManifest=JSON.parse(await readFile(new URL('../assets/audio/manifest.json',import.meta.url),'utf8'));
const stockSrc=JSON.parse(await readFile(new URL('../scripts/audio/sources.json',import.meta.url),'utf8'));
const SFX_SLOTS=['correct','wrong','tick','go','timeup','applause','cheer','click','levelup','coin','notify'];
assert.deepEqual(Object.keys(stockSrc.sfx).sort(),[...SFX_SLOTS].sort(),'every sound effect is pinned to a Mixkit asset');
for(const [slot,pin] of Object.entries(stockSrc.sfx))assert(Number.isInteger(pin.mixkitId)&&pin.title&&pin.category&&pin.max>0&&pin.max<=8,`${slot}: Mixkit pin is complete`);
assert.deepEqual(Object.keys(stockSrc.music).filter(k=>!/\d$/.test(k)||/^game\d$/.test(k)),['menu','game1','game2','game3','results'],'five music slots');assert(Object.keys(stockSrc.music).filter(k=>/^menu\d$/.test(k)).length>=2,'home music is a playlist of several tracks');
for(const [slot,m] of Object.entries(stockSrc.music))assert(m.oga&&/^https:\/\/opengameart\.org\/content\/[a-z0-9-]+$/.test(m.oga.page)&&m.oga.file,`${slot}: pinned OpenGameArt track`);
const audioBuilder=await readFile(new URL('../scripts/audio/stock-audio.mjs',import.meta.url),'utf8');
assert(audioBuilder.includes("const OGA_OK = l => /^CC0$/i.test(l);")&&/CC0 required/.test(audioBuilder),'OpenGameArt music must list CC0 on its live page or the build fails');
assert(!/fetch\([^)]*pixabay/i.test(audioBuilder)&&audioBuilder.includes('assets.mixkit.co/active_storage/sfx/')&&!/mixkit\.co\/free-stock-music/.test(audioBuilder),'Mixkit sound effects only; Pixabay music is never fetched automatically; no Mixkit music');
const MIXKIT=/^Mixkit Sound Effects Free License$/,PIXABAY=/^Pixabay Content License$/,COMMONS=/^(CC0|Public domain)$/i;
// 'notify' (Task 19) is checked as soon as the audio workflow has committed it to the manifest.
for(const slot of [...SFX_SLOTS.filter(k=>k!=='notify'||audioManifest.assets.notify),'music_menu','music_game1','music_game2','music_game3','music_results',...Object.keys(audioManifest.assets).filter(k=>/^music_[a-z]+\d+$/.test(k))]){const a=audioManifest.assets[slot];
  const ok=a&&((a.provider==='Mixkit'&&MIXKIT.test(a.licence)&&a.kind==='sfx'&&/^https:\/\/mixkit\.co\/free-sound-effects\//.test(a.source))
    ||(a.provider==='Pixabay'&&PIXABAY.test(a.licence)&&a.kind==='music'&&/^https:\/\/pixabay\.com\/music\//.test(a.source))
    ||(a.provider==='OpenGameArt'&&a.licence==='CC0'&&a.kind==='music'&&/^https:\/\/opengameart\.org\/content\//.test(a.source))
    ||(COMMONS.test(a.licence)&&/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(a.source)));
  assert(ok,`${slot}: licensed recording with a source`);
  const st=await import('node:fs').then(fs=>fs.statSync(new URL(`../${a.file}`,import.meta.url)));assert(st.size>1000&&st.size<1500000,`${slot}: encoded file present and small`)}
assert(!Object.values(audioManifest.assets).some(a=>a.provider==='Mixkit'&&a.kind==='music'),'Mixkit music is never used');
const licences=await readFile(new URL('../AUDIO_LICENSES.md',import.meta.url),'utf8');
for(const a of Object.values(audioManifest.assets))assert(licences.includes(a.file),`AUDIO_LICENSES.md documents ${a.file}`);
assert(!/\btone\(/.test(main),'no leftover synthetic tone() calls (they crashed every round)');
assert(main.includes('displayAnswers:shuffled(q.answers)'),'answer choices are shuffled independently');
assert(html.includes('id=\"play-featured\">Play now'),'primary action says Play now');
assert(!html.includes('id=\"backend-note\"'),'no technical backend status element');
const backend=await readFile(new URL('../src/backend.js',import.meta.url),'utf8');
const uiSource=`${html}\n${main}\n${backend}`;
assert(!/service reachable|function must be installed|account service is offline|service is not set up/i.test(uiSource),'no implementation-level backend messages in the UI');
assert(!/BOOT_ERROR|backend_not_ready|service_error|invalid_request|unknown_action|origin_not_allowed|method_not_allowed|session_expired|Uncaught|SyntaxError|Deno|Edge Function|Supabase CLI/i.test(uiSource),'no backend implementation codes or runtime errors surfaced in the UI');
assert(/Something went wrong\. Please try again\./.test(main)&&/The name, Login ID, or secret answer is incorrect\. Please try again\./.test(main),'failures fall back to generic, human wording');
const categoryRender=main.slice(main.indexOf('function renderCategories'),main.indexOf('function renderModes'));
assert(categoryRender.includes('<strong>${esc(c.name)}</strong>'),'category buttons contain the category name');
assert(!/category-mark|category-count|c\.count/.test(categoryRender)&&categoryRender.includes('<small class=\"category-desc\">${esc(c.description)}</small>'),'category buttons show the name and a short description, never a question count');
assert(html.includes('id=\"game-start\"')&&main.includes('Get ready!')&&main.includes("['3','2','1']")&&main.includes("'GO!'"),'ready screen and spoken countdown remain available');
assert(main.includes('Something went wrong. Please try again.')&&main.includes('Too many attempts. Please wait and try again.'),'client errors remain generic and rate limits are explained');
const migration=await readFile(new URL('../supabase/migrations/202609260001_core.sql',import.meta.url),'utf8');
for(const term of ['name_normalized text not null unique','login_id text not null unique','answer_hash text not null','enable row level security','bq_record_answer','unique(profile_id,question_id)'])assert(migration.includes(term),`schema requirement ${term}`);
const migration010=await readFile(new URL('../supabase/migrations/202610050010_add_200_questions.sql',import.meta.url),'utf8');
const m010Ids=[...migration010.matchAll(/values \('(bq-en-\d{4})'/g)].map(m=>m[1]);
assert.equal(m010Ids.length,200,'Migration 010 inserts exactly 200 rows');
assert.equal(m010Ids[0],'bq-en-0667','Migration 010 starts at bq-en-0667');
assert.equal(m010Ids.at(-1),'bq-en-0866','Migration 010 ends at bq-en-0866');
assert.equal((migration010.match(/ on conflict \(id\) do nothing;/g)||[]).length,200,'Migration 010 is additive and re-runnable');
assert(!/\b(create|alter|drop|truncate|delete|update)\s/i.test(migration010.replace(/'(?:[^']|'')*'/g,"''").replace(/--[^\n]*/g,'')),'Migration 010 contains no schema or destructive statements');
const migration011=await readFile(new URL('../supabase/migrations/202610050011_add_200_more_questions.sql',import.meta.url),'utf8');
const m011Ids=[...migration011.matchAll(/values \('(bq-en-\d{4})'/g)].map(m=>m[1]);
assert.equal(m011Ids.length,200,'Migration 011 inserts exactly 200 rows');
assert.equal(m011Ids[0],'bq-en-0867','Migration 011 starts at bq-en-0867');
assert.equal(m011Ids.at(-1),'bq-en-1066','Migration 011 ends at bq-en-1066');
assert.equal((migration011.match(/ on conflict \(id\) do nothing;/g)||[]).length,200,'Migration 011 is additive and re-runnable');
assert(!/\b(create|alter|drop|truncate|delete|update)\s/i.test(migration011.replace(/'(?:[^']|'')*'/g,"''").replace(/--[^\n]*/g,'')),'Migration 011 contains no schema or destructive statements');
const migration015=await readFile(new URL('../supabase/migrations/202610050015_add_five_categories.sql',import.meta.url),'utf8');
const m015Ids=[...migration015.matchAll(/values \('(bq-en-\d{4})','([a-z]+)'/g)];
assert.equal(m015Ids.length,100,'Migration 015 inserts exactly 100 rows');
assert.equal(m015Ids[0][1],'bq-en-1067');assert.equal(m015Ids.at(-1)[1],'bq-en-1166');
assert(m015Ids.every(m=>NEW_CATS.includes(m[2])),'Migration 015 only adds the five new categories');
assert.equal((migration015.match(/ on conflict \(id\) do nothing;/g)||[]).length,100,'Migration 015 is additive and re-runnable');
assert(!/\b(create|alter|drop|truncate|delete|update|grant|revoke)\s/i.test(migration015.replace(/'(?:[^']|'')*'/g,"''").replace(/--[^\n]*/g,'')),'Migration 015 contains no schema or destructive statements');
for(const q of QUESTION_BANK.slice(725)){assert.equal(new Set(q.answers).size,4,`${q.id} has 4 unique options`);assert(q.answers.includes(q.correctAnswer),`${q.id} includes its answer`);assert(/https:\/\//.test(q.sourceNote),`${q.id} has a source`)}
const fn=await readFile(new URL('../supabase/functions/blind-quiz-api/index.ts',import.meta.url),'utf8');
for(const term of ['PBKDF2','310000','name_taken','loginId','bq_consume_attempt','token_hash','record-answer'])assert(fn.includes(term),`server feature ${term}`);
assert.equal((fn.match(/^import \{ createClient \}/gm)||[]).length,1,'one Supabase client import');
assert.equal((fn.match(/\bcreateClient\s*\(/g)||[]).length,1,'one admin client initialization');
assert.equal((fn.match(/Deno\.serve\(handler\)/g)||[]).length,1,'one Edge Function entrypoint');
for(const term of ["action==='signup'","action==='login'","action==='recover-id'","action==='logout'","action==='record-answer'","action==='profile'"])assert(fn.includes(term),`server action ${term}`);
assert(fn.includes("return json({ok:false,code:'rate_limited'},429,origin)"),'server enforces rate limits');
assert(fn.includes("p_choice:choice"),'answer rewards use the server-side answer RPC');
const logArguments=[...fn.matchAll(/console\.(?:log|error)\(([^;]*?)\);/g)].map(m=>m[1].replace(/(['"])[^'"]*\1/g,''));
assert(logArguments.every(args=>!/(?:\bSECRET\b|\bPEPPER\b|\bAuthorization\b|\btoken\b|\banswer\b|\braw\b)/i.test(args)),'never log secrets, sessions, auth headers, or secret answers');
assert(!/secret answer.{0,50}console\.log/i.test(fn),'do not log secret answers');
// Update path: Reload button and network-first service worker.
assert(/<button class="text-button" id="reload-button" type="button" aria-label="[^"]+">Reload<\/button>/.test(html),'footer Reload button exists with an aria-label');
assert(/<span class="footer-actions">[\s\S]*id="reload-button"[\s\S]*id="logout-button"[\s\S]*<\/span><\/footer>/.test(html),'Reload and Log out share the footer actions group');
assert(css.includes('footer .footer-actions{')&&css.includes('footer .footer-actions button{margin-left:0}'),'footer actions styles');
const reloadWire=main.slice(main.indexOf("$('#reload-button')"));
assert(main.includes("$('#reload-button').addEventListener('click'"),'Reload button is wired');
assert(reloadWire.includes('window.location.reload()'),'Reload button calls window.location.reload()');
assert(reloadWire.indexOf("announce('Reloading Blind Quiz to get the latest version.',true)")>-1&&reloadWire.indexOf("announce('Reloading Blind Quiz")<reloadWire.indexOf('window.location.reload()'),'reload is announced before the page reloads');
const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
assert(sw.includes("const CACHE='blind-quiz-shell-v22'")&&sw.includes("'./src/direct.js'")&&sw.includes("'./src/rooms.js'")&&sw.includes("'./src/social.js'")&&sw.includes("'./src/e2ee.js'")&&sw.includes("'./src/chat.js'")&&sw.includes("'./src/sound-match.js'")&&sw.includes("'./src/sound-match-ui.js'")&&sw.includes("'./src/feedback.js'")&&sw.includes("'./src/questions-016.js'"),'service worker cache is v16 and caches the Migration 016 questions and the feedback module');
{ // Task 17: Sound Match - pure game logic, levels, audio wiring, licensed clip list.
  const { readFileSync } = await import('node:fs');
  const { SM_LEVELS, buildBoard, newMatchState, press, starsFor } = await import('../src/sound-match.js');
  assert.deepEqual(Object.fromEntries(Object.entries(SM_LEVELS).map(([k,v])=>[k,v.pairs*2])),{easy:10,medium:16,hard:20},'Easy shows numbers 1-10, Medium 1-16, Hard 1-20');
  const pool=[];for(const mood of ['funny','mysterious','cinematic','interesting'])for(let i=0;i<8;i++)pool.push({slot:`match_${mood}${i}`,name:`${mood} ${i}`,mood});
  let seed=7;const rnd=()=>((seed=(seed*16807)%2147483647)/2147483647);
  for(const lv of Object.values(SM_LEVELS)){const b=buildBoard(lv.pairs,pool,rnd);assert.equal(b.length,lv.pairs*2);assert.deepEqual(b.map(c=>c.number),b.map((_,i)=>i+1));
    const counts={};for(const c of b)counts[c.sound.slot]=(counts[c.sound.slot]||0)+1;assert(Object.values(counts).every(n=>n===2)&&Object.keys(counts).length===lv.pairs,'every sound is hidden behind exactly two numbers');
    assert(new Set(b.map(c=>c.sound.mood)).size===Math.min(4,lv.pairs),'boards mix the moods');}
  assert.throws(()=>buildBoard(5,pool.slice(0,3)),/not_enough_sounds/);
  const b=buildBoard(5,pool,rnd),st=newMatchState(b);const pairOf=n=>b.find(c=>c.number!==n&&c.sound.slot===b[n-1].sound.slot).number;const other=n=>b.find(c=>c.sound.slot!==b[n-1].sound.slot).number;
  assert.equal(press(st,1).type,'first');assert.equal(press(st,1).type,'replay','pressing the open number replays it');
  const miss=press(st,other(1));assert.equal(miss.type,'miss');assert.equal(st.open,null);assert.equal(st.tries,1);
  assert.equal(press(st,1).type,'first');const m=press(st,pairOf(1));assert.equal(m.type,'match');assert(st.matched.has(1)&&st.matched.has(pairOf(1)));assert.equal(press(st,1).type,'replay','found numbers can be heard again');
  for(const c of b){if(st.matched.has(c.number))continue;press(st,c.number);press(st,pairOf(c.number))}
  assert(st.done&&st.matched.size===10);assert.equal(press(st,2).type,'ignored');
  assert.equal(starsFor(5,5),3);assert.equal(starsFor(5,12),2);assert.equal(starsFor(5,20),1);
  const src=JSON.parse(readFileSync(new URL('../scripts/audio/sources.json',import.meta.url),'utf8'));const mm=Object.values(src.match);
  assert(mm.length>=20&&mm.length<=40,'20-40 Sound Match clips');assert.equal(new Set(mm.map(x=>x.mixkitId)).size,mm.length,'no clip twice');
  for(const mood of ['funny','mysterious','cinematic'])assert(mm.filter(x=>x.mood===mood).length>=6,`enough ${mood} clips`);
  assert(mm.every(x=>Number.isInteger(x.mixkitId)&&x.name&&x.max<=3),'Mixkit ids, names, short clips');
  const au=readFileSync(new URL('../src/audio.js',import.meta.url),'utf8');assert(/view === 'soundmatch'\) return null/.test(au)&&/if \(slot == null\) \{ wantedSlot = null; stopMusic\(\); return; \}/.test(au),'no background music over Sound Match clues');
  assert(!/AudioContext|createOscillator|speechSynthesis/.test(au+readFileSync(new URL('../src/sound-match-ui.js',import.meta.url),'utf8')),'recorded audio only');
  assert(html.includes('id="sm-open"')&&html.includes('id="view-soundmatch"')&&html.includes('data-sm-level="easy"'),'Sound Match entry and screen');
  const m18=readFileSync(new URL('../supabase/migrations/202610060018_sound_match_rewards.sql',import.meta.url),'utf8');
  assert(/when 'easy' then 5 when 'medium' then 10 else 15 end \* case when g_stars = 3 then 2 else 1 end/.test(m18)&&/when 'easy' then 1 when 'medium' then 2 else 3 end/.test(m18),'Sound Match rewards: 5/10/15 XP (doubled for 3 stars) and 1/2/3 coins');
  assert(/p_tries <= ceil\(g\.pairs \* 1\.6\) then 3 when p_tries <= g\.pairs \* 2\.5 then 2/.test(m18),'server stars match the client stars');
  const smui=readFileSync(new URL('../src/sound-match-ui.js',import.meta.url),'utf8');assert(smui.includes("callApi('soundmatch-start'")&&smui.includes("callApi('soundmatch-finish'")&&smui.includes('You earned ${r.xp} XP and ${r.coins} coin')&&!/profile XP/.test(smui),'rewards wording: You earned N XP and N coins');
}
{ // Task 17: Migration 016 - 250 questions (10 per category) and the 5 XP + 1 coin word reward.
  const { readFileSync } = await import('node:fs');
  const { MIGRATION_016_ROWS } = await import('../src/questions-016.js');
  assert.equal(MIGRATION_016_ROWS.length,250,'Migration 016 has 250 questions');
  const per={};for(const r of MIGRATION_016_ROWS)per[r[0]]=(per[r[0]]||0)+1;
  assert(Object.keys(per).length===25&&Object.values(per).every(n=>n===10),'Migration 016 has 10 questions in each of the 25 categories');
  assert.equal(QUESTION_BANK.at(-250).id,'bq-en-1167');assert.equal(QUESTION_BANK.at(-1).id,'bq-en-1416');
  const m16=readFileSync(new URL('../supabase/migrations/202610060016_questions_and_word_reward.sql',import.meta.url),'utf8');
  assert.equal((m16.match(/^insert into public\.bq_questions/gm)||[]).length,250,'Migration 016 inserts 250 rows');
  assert(/on conflict \(id\) do nothing;\ncreate or replace function public\.bq_record_word/.test(m16)&&m16.includes('earned_xp := 5;\n  earned_coins := 1;')&&/grant execute on function public\.bq_record_word\(uuid, text\) to service_role;\ncommit;\n$/.test(m16),'Migration 016 pays 5 XP + 1 coin per first word find and stays service-role only');
  assert(!/to (anon|authenticated|public);/.test(m16),'Migration 016 grants nothing to clients');
}
assert(sw.includes("'./privacy-policy.html'")&&sw.includes("'./terms-and-conditions.html'"),'legal pages are cached for offline use');
assert(sw.includes('fetch(req)')&&sw.includes('caches.match(req)')&&sw.indexOf('fetch(req)')<sw.indexOf('caches.match(req)'),'service worker is network-first (fetch before cache)');
const swCatch=sw.slice(sw.indexOf('.catch('));
assert(sw.includes('.catch(')&&swCatch.includes('caches.match(req)')&&swCatch.includes("caches.match('./index.html')"),'offline .catch() fallback to cache and ./index.html still exists');
// One-tap sign in: Name and Login ID remembered on the device; the secret answer never is.
assert(html.includes('id="remembered-device"')&&html.includes('id="forget-device"'),'remembered-device notice and forget control');
assert(main.includes("const REMEMBER_KEY='blindquiz.remembered.v1'"),'remembered sign-in key');
const rememberSave=main.match(/function rememberDevice\([^)]*\)\{[^\n]*?\}\}/)?.[0]||'';
assert(rememberSave.includes('JSON.stringify({name,loginId})')&&!/answer/i.test(rememberSave),'only name and Login ID are remembered');
assert(!/localStorage\.setItem\([^;]*answer/i.test(main)&&!/sessionStorage\.setItem\([^;]*answer/i.test(main),'secret answer is never written to storage');
const loginFn=main.slice(main.indexOf('async function login('),main.indexOf('async function recoverLoginId('));
assert(loginFn.indexOf('rememberDevice(')>loginFn.indexOf("callApi('login'"),'device is remembered only after a successful login');
assert(main.includes('are already filled in. Type your secret answer to sign in.'),'prefilled state is announced');
assert(main.includes("getRemembered()?'#login-answer':'#login-name'"),'focus goes straight to the secret answer when prefilled');
const manifest=JSON.parse(await readFile(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
assert.equal(manifest.name.startsWith('Blind Quiz'),true);
// Installable PWA stays intact alongside the Android wrapper.
assert(manifest.display==='standalone'&&manifest.start_url&&manifest.scope&&manifest.icons?.length,'PWA manifest is installable');
assert(html.includes('rel="manifest" href="manifest.webmanifest"')&&main.includes("navigator.serviceWorker.register('./sw.js')"),'PWA manifest link and service worker registration');
const dart=await readFile(new URL('../android-app/lib/main.dart',import.meta.url),'utf8');
assert(dart.includes("const String kLiveUrl = 'https://mahicouragw.github.io/Blind-Quiz/'")&&dart.includes("label: 'Reload to get the latest version'")&&dart.includes('_controller.reload()'),'Android wrapper loads the live URL and has an accessible Reload button');
// Task 9: production hardening.
assert(!/question-count|playable questions/.test(html)&&!main.includes('question-count'),'no internal question counts in the UI');
assert(!/console\.(log|debug|info|warn|error)|debugger/.test(main+backend),'no console output or debugger statements in the frontend');
assert(/<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self';[^"]*connect-src 'self' https:\/\/zchircgdkyjnowqcdwvf\.supabase\.co;[^"]*object-src 'none'; base-uri 'self'/.test(html),'strict Content-Security-Policy');
assert(!/\sstyle="|<script(?![^>]*\ssrc=)[^>]*>|\son[a-z]+="/i.test(html),'no inline scripts, styles, or event handlers (CSP-compatible)');
assert(/<section class="legal-links"[\s\S]*<a href="privacy-policy\.html" id="privacy-link">Privacy Policy<\/a>[\s\S]*<a href="terms-and-conditions\.html" id="terms-link">Terms and Conditions<\/a>/.test(html),'Settings links to Privacy Policy and Terms and Conditions');
for(const page of ['privacy-policy.html','terms-and-conditions.html']){const legal=await readFile(new URL(`../${page}`,import.meta.url),'utf8');assert(legal.includes('<html lang="en">')&&legal.includes('<main id="main"')&&(legal.match(/<h1>/g)||[]).length===1&&legal.includes('href="./"')&&legal.includes('Content-Security-Policy'),`${page} is a complete, accessible page`);assert(!/supabase\.co|sb_publishable|bq_[a-z]|service_role/i.test(legal),`${page} exposes no internal identifiers`)}
assert(backend.includes('sessionStorage')&&!backend.includes('localStorage'),'session token is kept in sessionStorage only');
assert(backend.includes('Date.parse(s.expiresAt)<=Date.now()'),'locally expired sessions are discarded');
assert(backend.includes('res.status===401&&session?.token'),'server-rejected sessions are cleared');
assert(main.includes("async function restoreSession(){")&&main.includes("callApi('profile')"),'session is re-validated with the server after a reload');
assert(main.includes("err.message==='invalid_credentials'?genericLogin:genericFailure"),'server failures are not reported as wrong credentials');
assert(fn.includes("permitAccount('login'")&&fn.includes("permitAccount('recover'")&&fn.includes("permitAccount('question'")&&fn.includes("permitAccount('report'"),'IP-independent per-account rate limits');
assert(dart.includes('NavDecision classifyNavigation(')&&dart.includes("if (uri.scheme != 'https') return NavDecision.block;")&&dart.includes('LaunchMode.externalApplication'),'Android wrapper: HTTPS-only allowlist, external links open in the browser');
assert(dart.includes('AndroidWebViewController.enableDebugging(kDebugMode)')&&dart.includes('setAllowFileAccess(false)'),'Android wrapper: no WebView debugging in release, no file access');
assert(dart.includes("Reload failed. Check your internet connection, then try again.")&&!dart.includes('clearLocalStorage'),'Android Reload reports failures and keeps web storage (session)');
// Migrations 001-014 are applied remotely and must stay byte-identical.
{
  const { createHash }=await import('node:crypto');
  const pinned={'202609260001_core.sql':'40df2f781cd3bcdc1787f6b5642761e628d597a9ba4ae0029de2d9b78fad58b6','202610030009_expand_question_bank.sql':'c5b814bd4c90395c2d784f82e3d9f09dba37fc628450720f459c41d2ec570c58','202610050010_add_200_questions.sql':'98e612b531be5d391b311603eb45aa66dde7c82dd44207b99809b02c839bf138','202610050011_add_200_more_questions.sql':'9ca537070278ac72a440bf0b43c5d0eaeafa0e1cad0d3a727aade29d2b0df9b1','202610050012_privilege_hardening.sql':'6a9420c4c444a47e47363fca48d331ea25014ec0db2954d047e6d9cc98732075','202610050014_two_letter_words.sql':'5af7511582affd95e7804bb731a7f23ebc3aa15b2e113ad15ffd020d5bd7b417','202610050013_profile_changes_and_words.sql':'a959267f4b2eb9afe580280e22cd719022ca135196c892cf1e5ee670a0caead5'};
  for(const [f,h] of Object.entries(pinned))assert(createHash('sha256').update(await readFile(new URL('../supabase/migrations/'+f,import.meta.url))).digest('hex')===h,`migration ${f} must stay byte-identical`);
}
// Letters to Words dictionary: real SCOWL words, clean, and identical in the game and in the server seed (Migration 013).
{
  const { WORD_TIERS }=await import('../src/words.js');
  const m013=await readFile(new URL('../supabase/migrations/202610050013_profile_changes_and_words.sql',import.meta.url),'utf8');
  const seeded=[...m013.matchAll(/^  \((\d), '([a-z ]*)'\),?$/gm)].map(x=>x[2]);
  assert(seeded.length===3&&seeded.every((l,i)=>l===WORD_TIERS[i]),'bq_words seed matches src/words.js');
  const all=WORD_TIERS.join(' ').split(' ');assert(new Set(all).size===all.length,'no duplicate words across tiers');
  assert(all.every(w=>/^[a-z]{3,7}$/.test(w)),'words are lowercase a-z, 3-7 letters');
  const block=(await readFile(new URL('../scripts/words/blocklist.txt',import.meta.url),'utf8')).split('\n').filter(l=>!l.startsWith('#')).join(' ').split(/\s+/).filter(Boolean);
  const set=new Set(all);assert(block.every(w=>!set.has(w)),'no blocklisted word in the dictionary');
  assert(WORD_TIERS[0].split(' ').length>2000&&set.has('for')&&set.has('ford')&&!set.has('hes')&&!set.has('sex'),'tier 1 holds the common words');
  assert(existsSync(new URL('../WORDS_LICENSE.md',import.meta.url))&&(await readFile(new URL('../WORDS_LICENSE.md',import.meta.url),'utf8')).includes('Kevin Atkinson'),'SCOWL licence notice is shipped');
}
// Two-letter words: identical in the game and in the Migration 014 seed; puzzles accept them.
{
  const { SHORT_WORD_TIERS }=await import('../src/short-words.js');const { solutionsFor }=await import('../src/letters.js');
  const m014=await readFile(new URL('../supabase/migrations/202610050014_two_letter_words.sql',import.meta.url),'utf8');
  const seeded=[...m014.matchAll(/^  \((\d), '([a-z ]*)'\),?$/gm)].map(x=>x[2]);
  assert(seeded.length===3&&seeded.every((l,i)=>l===SHORT_WORD_TIERS[i]),'Migration 014 seed matches src/short-words.js');
  assert(sw.includes("'./src/short-words.js'"),'service worker caches short-words.js');
  assert(SHORT_WORD_TIERS.join(' ').split(' ').every(w=>/^[a-z]{2}$/.test(w)),'only two-letter words');
  const ftoo=solutionsFor('ftoo');assert(['foot','too','of','to'].every(w=>ftoo.includes(w)),'F T O O gives FOOT, TOO, OF, TO');
}
// Automatic level-up: XP thresholds, harder levels, server-equal word XP, recorded level-up and coin sounds.
{
  const { LEVELS, wordXp, roundBonus, applyLevelXp, MAX_LEVEL }=await import('../src/letters.js');
  assert.equal(LEVELS.length,20,'20 levels');
  const H=l=>l.hints??Infinity;
  for(let i=1;i<LEVELS.length;i++){const a=LEVELS[i-1],b=LEVELS[i];
    assert(b.goal>=a.goal&&b.letters>=a.letters&&(b.seedTiers.length>=a.seedTiers.length||b.letters>a.letters)&&(b.long||0)>=(a.long||0)&&H(b)<=H(a),`level ${i+1} is never easier than level ${i}`);
    assert(b.goal>a.goal||b.letters>a.letters||b.seedTiers.length>a.seedTiers.length||(b.long||0)>(a.long||0)||H(b)<H(a),`level ${i+1} is harder than level ${i}`);
    assert(Number.isFinite(a.xp)&&a.xp>0&&b.xp>a.xp,'XP targets rise');assert(a.name&&a.describe,'levels have a name and description')}
  assert.equal(LEVELS[0].letters,4);assert.equal(MAX_LEVEL,LEVELS.length);
  assert.deepEqual(['of','too','word','lights','letters'].map(wordXp),[1,2,3,5,6],'word XP matches bq_record_word (2 letters 1 XP, else 2-6 by length)');
  assert.deepEqual(applyLevelXp(1,28,roundBonus(1)),{level:2,levelXp:0,levelledUp:true},'level-up is automatic when the target is reached');
  assert.deepEqual(applyLevelXp(1,0,9),{level:1,levelXp:9,levelledUp:false});
  assert.equal(applyLevelXp(MAX_LEVEL,10,5).level,MAX_LEVEL,'no level beyond the top');
  const ui=await readFile(new URL('../src/letters-ui.js',import.meta.url),'utf8');
  assert(/playSequence\(res\.levelledUp \? \['applause', 'levelup'\] : \['applause'\]\)/.test(ui),'round sound, then the level-up sound');
  assert(!/profile level|Profile level|Letters level/i.test(ui)&&ui.includes('` Level up! You are now Level ${res.level}.`'),'level-up says only "Level up! You are now Level N."');
  assert(ui.includes('Level up! You are now Level')&&ui.includes('focusStatus(text)')&&!ui.includes('letters-next'),'level-up announced and focused; no manual level button');
  assert(stockSrc.sfx.levelup&&stockSrc.sfx.coin,'level-up and coin sounds are pinned recordings');
  assert(/'levelup', 'coin'/.test(audioSrc)&&/export async function playSequence/.test(audioSrc),'audio knows the new sounds and plays effects in sequence');
  assert(/levelUpLine\(prevLevel,saved\.profile\?\.level\)/.test(main)&&/playSequence\(up\?\['coin','levelup'\]:\['coin'\]\)/.test(main),'quiz announces profile level-ups with the level-up sound');
}
// Letters to Words: every generated puzzle is solvable, uses only the seed's letters, and grows harder.
{
  const { makePuzzle, LEVELS, fits, isWord }=await import('../src/letters.js');
  let prev=0;
  for(let level=1;level<=LEVELS.length+2;level++){
    const rules=LEVELS[Math.min(level,LEVELS.length)-1];assert(rules.letters>=prev,'levels never get shorter');prev=rules.letters;
    for(let i=0;i<60;i++){const p=makePuzzle(level);const L=p.letters.join('');
      assert(p.longGoal<=p.common.filter(w=>w.length>=5).length&&p.hints===(rules.hints??Infinity),`level ${level} long-word goal is achievable`);
      assert(p.letters.length===rules.letters&&p.solutions.length>=1&&p.common.length>=p.goal&&p.goal>=Math.min(rules.goal,p.common.length),`level ${level} puzzle ${L} is solvable with goal ${p.goal}`);
      assert(p.solutions.every(w=>isWord(w)&&fits(w,L)&&w.length>=2),`level ${level}: answers use only the supplied letters`);}
  }
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert(html.includes('id="view-letters"')&&html.includes('id="letters-tiles" role="group" aria-label="Letters"')&&!/id="view-letters"[\s\S]*?<input[\s\S]*?id="view-settings"/.test(html),'Letters to Words view has a letter group and no text inputs');
  assert(html.includes('id="profile-change"')&&html.includes('id="edit-userid"')&&!html.includes('id="edit-userid"><input'),'profile Change screen with read-only User ID');
  assert(!html.includes('<dl class="profile-stats"'),'profile stats are not a definition list');
}
console.log(`PASS: ${QUESTION_BANK.length} structured questions, ${CATEGORY_LIST.length} categories, shuffle/content/schema/security/accessibility source checks.`);
{ // Task 15: visuals for sighted players are decorative only, so screen-reader output does not change
  const html2=await readFile(new URL('../index.html',import.meta.url),'utf8'),main2=await readFile(new URL('../src/main.js',import.meta.url),'utf8'),lui=await readFile(new URL('../src/letters-ui.js',import.meta.url),'utf8'),css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  assert(/<span class="hud" aria-hidden="true">[\s\S]*id="hud-timer"[\s\S]*id="hud-score"/.test(html2),'visible timer and score HUD is aria-hidden (announcements already cover it)');
  assert(html2.includes('id="result-stars" aria-hidden="true"')&&html2.includes('id="letters-slots" aria-hidden="true"')&&html2.includes('id="letters-pips" aria-hidden="true"'),'stars, word slots and goal pips are decorative');
  assert(/category-icon\\?" aria-hidden=\\?"true/.test(main2)&&main2.includes("CATEGORY_ICON={"),'category icons are aria-hidden');
  assert(/function updateHud\(\)/.test(main2)&&/state\.timeLeft--;updateHud\(\)/.test(main2),'timer is shown visually every second');
  assert(/dataset\.order/.test(lui)&&/prefers-reduced-motion:reduce/.test(css)&&/\.reduce-motion \*/.test(css),'pick order shown on tiles; animations honour reduced motion');
  assert(html2.includes('<b id="total-categories">25</b> categories'),'home shows the current category count');
}
console.log('PASS: Task 15 sighted-player visuals are decorative and motion-safe.');

{ // Task 16: own game identity (self-hosted OFL fonts), Get the app section with QR codes and APK link
  const { statSync, existsSync } = await import('node:fs');
  const html3=await readFile(new URL('../index.html',import.meta.url),'utf8'),css3=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  for(const f of ['atkinson-hyperlegible-latin-400-normal.woff2','atkinson-hyperlegible-latin-700-normal.woff2','bungee-latin-400-normal.woff2'])assert(statSync(new URL(`../assets/fonts/${f}`,import.meta.url)).size>5000&&css3.includes(`assets/fonts/${f}`),`font ${f} is self-hosted and used`);
  assert(/SIL Open Font License/i.test(await readFile(new URL('../assets/fonts/OFL.txt',import.meta.url),'utf8')),'font licence shipped');
  assert(!/fonts\.googleapis|fonts\.gstatic/.test(html3+css3),'no third-party font requests (CSP stays self-only)');
  assert(html3.includes('href="download/blind-quiz.apk" download')&&html3.includes('src="assets/qr-apk.svg"')&&html3.includes('src="assets/qr-site.svg"')&&existsSync(new URL('../assets/qr-apk.svg',import.meta.url)),'Get the app: APK link and QR codes');
  assert(!/No email, password, phone, or OTP|Anyone who knows it may be able to access/.test(html3)&&html3.includes('Log in with your name, Login ID and secret answer.'),'simplified sign-in text');
  const sw3=await readFile(new URL('../sw.js',import.meta.url),'utf8');assert(sw3.includes("url.pathname.includes('/download/')"),'service worker never caches the APK');
}
console.log('PASS: Task 16 identity, fonts, app download and sign-in text.');
{ // Task 16: word meanings in Letters to Words (WordNet, bundled, fetched per first letter)
  const { readdirSync, readFileSync } = await import('node:fs');
  const { WORD_TIERS } = await import('../src/words.js'); const { SHORT_WORD_TIERS } = await import('../src/short-words.js');
  const dir = new URL('../assets/meanings/', import.meta.url);
  const all = Object.assign({}, ...readdirSync(dir).filter(f => /^[a-z]\.json$/.test(f)).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
  const words = [...new Set([...SHORT_WORD_TIERS, ...WORD_TIERS].flatMap(t => t.split(' ')).filter(Boolean))];
  const missing = words.filter(w => !all[w]);
  assert(missing.length / words.length < 0.03, `meanings cover at least 97% of answer words (missing ${missing.length})`);
  for (const w of ['see', 'sees', 'ran', 'is', 'cat', 'tiger']) assert(all[w], `meaning for ${w}`);
  assert(!/goddess|Maine|nursing/.test(JSON.stringify([all.ate, all.me, all.an])), 'no proper-noun or abbreviation senses for everyday words');
  assert(/WordNet 3\.1 Copyright 2011 by Princeton University/.test(readFileSync(new URL('LICENSE.txt', dir), 'utf8')), 'WordNet licence shipped with the meanings');
  const lui = readFileSync(new URL('../src/letters-ui.js', import.meta.url), 'utf8');
  assert(!/earlier game|profile XP/.test(lui), 'no "earlier game" or "profile XP" wording');
  assert(lui.includes('meaningLine(m)') && readFileSync(new URL('../index.html', import.meta.url), 'utf8').includes('id="letters-meaning"'), 'meaning is spoken and shown');
}
console.log('PASS: Task 16 word meanings for Letters to Words.');
{ // Task 17: legal links only in Settings (never in the footer shown during play); Contact us email in Settings
  const { readFileSync } = await import('node:fs');
  const h=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const footer=h.slice(h.indexOf('<footer'),h.indexOf('</footer>'));
  assert(!/privacy-policy|terms-and-conditions/.test(footer),'no legal links in the game footer');
  const settings=h.slice(h.indexOf('id="view-settings"'),h.indexOf('id="view-results"'));
  assert(settings.includes('href="privacy-policy.html"')&&settings.includes('href="terms-and-conditions.html"'),'legal links stay in Settings');
  assert(settings.includes('href="mailto:numbersareplaying@gmail.com?subject=Blind%20Quiz%20feedback"')&&settings.includes('id="copy-email"'),'Contact us email and copy button in Settings');
  for(const p of ['privacy-policy.html','terms-and-conditions.html'])assert(readFileSync(new URL('../'+p,import.meta.url),'utf8').includes('mailto:numbersareplaying@gmail.com'),p+' contact email');
}
console.log('PASS: Task 17 legal links in Settings only, Contact us email.');
// Task 19 stage A/B: notifications, feedback replies, presence, player cards and friends (Migration 019).
{
  const { readFileSync } = await import('node:fs');
  const r = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const m19 = r('supabase/migrations/202610060019_social_notifications.sql'), soc = r('src/social.js'), api = r('supabase/functions/blind-quiz-api/index.ts'), html = r('index.html'), fb = r('src/feedback.js');
  assert(!/\b(drop|truncate)\b/i.test(m19.replace(/--[^\n]*/g, '')) && /create table if not exists public\.bq_friendships/.test(m19) && /create table if not exists public\.bq_notifications/.test(m19), 'Migration 019 is additive');
  const card = m19.slice(m19.indexOf('function public.bq_player_card'), m19.indexOf('function public.bq_friend_request'));
  assert(card.length > 100 && !/login_id|secret_question|answer_hash|answer_salt/.test(card), 'player cards never include the Login ID, secret question or hashes');
  assert(!/loginId|login_id|secretQuestion/.test(soc), 'the social UI never reads Login IDs or secret questions');
  for (const a of ['touch', 'notifications', 'notifications-read', 'set-notifications', 'my-feedback', 'online-players', 'player-card', 'friend-request', 'friend-respond', 'friend-remove', 'friends', 'admin-feedback-reply', 'admin-announce']) assert(api.includes(`'${a}':['bq_`), `API social action ${a}`);
  assert(/'admin-feedback-reply':\['bq_feedback_reply',[^\n]*,true\]/.test(api) && /'admin-announce':\['bq_announce',[^\n]*,true\]/.test(api) && /if\(adminOnly&&!await isAdmin\(profileId\)\)/.test(api), 'admin social actions are admin only');
  for (const id of ['notif-open', 'view-notifications', 'view-multiplayer', 'view-player', 'notif-on', 'my-feedback-box', 'announce-form', 'mp-open']) assert(html.includes(`id="${id}"`), `UI element ${id}`);
  assert(fb.includes("callApi('admin-feedback-reply'") && fb.includes("callApi('admin-announce'"), 'admin inbox can reply and announce');
  assert(soc.includes('To send ${p.name} a match, you need to be friends first.') && soc.includes("act('friend-request'"), 'matches need friendship; Add friend sends a request');
  assert(JSON.parse(r('scripts/audio/sources.json')).sfx.notify?.mixkitId === 253, 'notification chime is a pinned Mixkit recording');
  console.log('PASS: Task 19 notifications, feedback replies, player cards and friends (private by design).');
}
// Task 19 stage F: Android device notifications. Polling heartbeat, no push service and no Firebase;
// the Android WebView has no browser Notification API, so the app bridges window.BQNotifications.
{
  const { readFileSync } = await import('node:fs');
  const r = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const soc = r('src/social.js'), kt = r('android-app/native/MainActivity.kt'), dart = r('android-app/lib/main.dart'),
    wf = r('.github/workflows/build-android.yml'), html = r('index.html'), sw = r('sw.js');
  for (const s of ["const NATIVE_CHANNEL = 'BQNotifications'", 'window.bqDeviceNotificationPermission', 'window.bqNotificationOpened',
    "nativePost({ op: 'permission' })", "nativePost({ op: 'state' })", "nativePost({ op: 'post', id: ++nativeId, title: 'Blind Quiz', body: text, kind })",
    'notificationText(fresh[0])']) assert(soc.includes(s), `social.js: ${s}`);
  assert(/if \(!deviceReady\(\) \|\| !document\.hidden\) return;/.test(soc), 'device alerts only while the game is in the background');
  assert(soc.includes('await Notification.requestPermission()') && soc.includes("new Notification('Blind Quiz'"), 'the browser Notification path still works');
  const socCode = soc.replace(/\/\/[^\n]*/g, '');
  assert(!/firebase|fcm|push[_ -]?(service|provider|key)|wss?:\/\//i.test(socCode), 'no push service, no socket on the page side');
  for (const s of ['blind_quiz/notifications', 'blind_quiz_notifications', 'POST_NOTIFICATIONS', 'requestNotificationsPermission', 'cancelAll()', 'setAutoCancel(true)', 'openNotificationsOnStart'])
    assert(kt.includes(s), `MainActivity.kt: ${s}`);
  assert(kt.includes('private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"'), 'the notification permission is written as a literal, not a compileSdk constant');
  for (const s of ["addJavaScriptChannel('BQNotifications'", "notificationBody(", 'kNotifications.invokeMethod', 'window.bqNotificationOpened', 'kMaxNotificationChars'])
    assert(dart.includes(s), `main.dart: ${s}`);
  assert(wf.includes('android.permission.POST_NOTIFICATIONS') && wf.includes('POST_NOTIFICATIONS)|io'), 'the manifest asks for POST_NOTIFICATIONS and the audit allowlists exactly that');
  assert(html.includes('id="notif-device-hint"'), 'Settings explains where device notifications appear');
  assert(sw.includes("const CACHE='blind-quiz-shell-v22'"), 'service worker cache is v22');
  console.log('PASS: Task 19 stage F Android device notifications (native bridge, polling delivery, no push service, no Firebase).');
}
// Task 19 stage C: end-to-end encryption with real WebCrypto (Node has the same API as browsers).
{
  const { readFileSync } = await import('node:fs');
  const E = await import('../src/e2ee.js');
  const alice = await E.deviceKey(E.memoryStore(), 'A'), bob = await E.deviceKey(E.memoryStore(), 'B'), bob2 = await E.deviceKey(E.memoryStore(), 'B2'), eve = await E.deviceKey(E.memoryStore(), 'E');
  assert(/^[A-Za-z0-9+/]{87}=$/.test(alice.publicKey) && alice.privateKey.extractable === false, 'device public key is raw P-256 base64; the private key is non-extractable');
  const store = E.memoryStore(); const k1 = await E.deviceKey(store, 'X'), k2 = await E.deviceKey(store, 'X'); assert(k1.deviceId === k2.deviceId, 'the device key is kept');
  const boxes = await E.seal('Meet in room Blind Quiz at 7?', alice, [bob, bob2, alice]);
  assert.deepEqual(Object.keys(boxes).sort(), [bob.deviceId, bob2.deviceId, alice.deviceId].sort(), 'one sealed box per device');
  assert(!JSON.stringify(boxes).includes('Meet'), 'ciphertext only');
  assert.equal((await E.open(boxes[bob.deviceId], bob, alice.deviceId, alice.publicKey)).t, 'Meet in room Blind Quiz at 7?');
  assert.equal((await E.open(boxes[bob2.deviceId], bob2, alice.deviceId, alice.publicKey)).t, 'Meet in room Blind Quiz at 7?');
  assert.equal((await E.open(boxes[alice.deviceId], alice, alice.deviceId, alice.publicKey)).t, 'Meet in room Blind Quiz at 7?', 'the sender can read its own copy');
  const rejects = async f => { try { await f(); return false; } catch { return true; } };
  assert(await rejects(() => E.open(boxes[bob.deviceId], eve, alice.deviceId, alice.publicKey)), 'another device cannot open the box');
  const flipped = { ...boxes[bob.deviceId], ct: (() => { const b = E.unb64(boxes[bob.deviceId].ct); b[3] ^= 1; return E.b64(b); })() };
  assert(await rejects(() => E.open(flipped, bob, alice.deviceId, alice.publicKey)), 'a changed message fails verification');
  assert(await rejects(() => E.open(boxes[bob.deviceId], bob, alice.deviceId, eve.publicKey)), 'a swapped sender key fails');
  assert(await rejects(() => E.open(boxes[bob.deviceId], bob, bob2.deviceId, alice.publicKey)), 'the box is bound to its sender device id');
  const c1 = await E.safetyCode([alice.publicKey], [bob.publicKey, bob2.publicKey]), c2 = await E.safetyCode([bob2.publicKey, bob.publicKey], [alice.publicKey]);
  assert(c1 === c2 && /^(\d{5} ){5}\d{5}$/.test(c1) && c1 !== await E.safetyCode([alice.publicKey], [bob.publicKey, eve.publicKey]), 'safety code is the same on both sides and changes with the keys');
  const ls = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } }; const pins = E.keyPins(ls, 'acct');
  assert(pins.check('Bob', ['k1']).firstTime); pins.accept('Bob', ['k1']); assert(!pins.check('bob', ['k1']).changed && pins.check('Bob', ['k1', 'k2']).changed, 'key pinning warns about new keys');
  const chat = readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8'), api = readFileSync(new URL('../supabase/functions/blind-quiz-api/index.ts', import.meta.url), 'utf8'), m20 = readFileSync(new URL('../supabase/migrations/202610060020_private_messages.sql', import.meta.url), 'utf8');
  assert(!/callApi\('send-message',\s*\{[^}]*\btext\b/.test(chat) && /callApi\('send-message', \{ name: friend, deviceId: me\.deviceId, boxes \}\)/.test(chat), 'only sealed boxes are sent, never the text');
  assert(!/\b(body|plaintext|message)\s+text\b/i.test(m20.slice(m20.indexOf('create table if not exists public.bq_messages'), m20.indexOf('create index if not exists bq_messages_pair_idx'))), 'the messages table has no plaintext column');
  assert(/'send-message':\['bq_send_message',boxesArg,300\]/.test(api) && /'message-keys':\['bq_message_keys',nameArg,600\]/.test(api), 'message API actions');
  assert(/Send \$\{p\.name\} a private message/.test(readFileSync(new URL('../src/social.js', import.meta.url), 'utf8')), 'friends can open a private chat from the card');
  console.log('PASS: Task 19 end-to-end encrypted private messages (real WebCrypto: seal, open, tamper and key-swap rejection, safety code, key pinning).');
}
// Task 19 stage D: rooms, room games, spectators hearing the player's sounds and announcements, comments.
{
  const { readFileSync } = await import('node:fs');
  const R = await import('../src/rooms.js');
  const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
  const main = read('../src/main.js'), html = read('../index.html'), social = read('../src/social.js'), api = read('../supabase/functions/blind-quiz-api/index.ts'), rooms = read('../src/rooms.js');
  assert(R.gameTitle('quiz', { category: 'history', mode: 'rapid' }, [{ id: 'history', name: 'History' }]) === 'Quiz: History, Rapid Fire' && R.gameTitle('soundmatch', { level: 'hard' }) === 'Sound Match: Hard' && R.gameTitle('letters') === 'Letters to Words', 'room game titles');
  assert(R.eventText({ kind: 'say', name: 'Ann', body: 'Correct!' }) === "Ann's game: Correct!" && R.eventText({ kind: 'comment', name: 'Bo', body: 'Nice' }) === 'Bo commented: Nice' && R.eventText({ kind: 'sfx', name: 'Ann', body: 'correct' }) === null, 'spectator log lines (sound effects are heard, not listed)');
  for (const id of ['view-room', 'view-watch', 'mp-rooms', 'mp-room-list', 'room-create-form', 'room-new-public', 'room-games', 'room-game-form', 'room-game-kind', 'room-game-category', 'room-game-mode', 'room-game-level', 'room-chat', 'room-chat-form', 'room-invite-form', 'watch-log', 'watch-scores', 'watch-comment-form', 'back-to-room']) assert(html.includes(`id="${id}"`), `rooms markup #${id}`);
  assert(html.includes('data-mp-tab="rooms"'), 'Rooms tab in Multiplayer');
  for (const a of ['rooms', 'room-create', 'room-remove', 'room-leave', 'room-state', 'room-say', 'room-invite', 'match-invite', 'game-create', 'game-join', 'game-watch', 'game-post']) assert(api.includes(`'${a}':['bq_`), `API action ${a}`);
  assert(/function livePush\(k,b\)\{if\(!live\|\|/.test(main) && /const announce=\(text,urgent=false\)=>\{livePush\('say',text\);/.test(main) && /function playSfx\(slot,\.\.\.a\)\{livePush\('sfx',slot\)/.test(main) && /function playMatchSound\(slot,\.\.\.a\)\{livePush\('match',slot\)/.test(main), 'room games broadcast announcements, sound effects and Sound Match sounds only while live');
  assert(/playSfx:rawSfx,playMatchSound:rawMatch/.test(main), 'spectators replay with plain audio (never re-broadcast)');
  assert(/state\.view==='room'&&\(view==='watch'\|\|\(live&&view===LIVE_VIEWS\[live\.kind\]\)\)/.test(main), 'starting or watching a room game does not ask to leave the room');
  assert(/Send \$\{p\.name\} a match/.test(social) && /callApi\('match-invite'/.test(social) && /'room_invite', 'game_invite'\].includes\(n\.kind\) && n\.ref/.test(social), 'friends can send a match; invites open the room');
  assert(!/loginId|login_id/.test(rooms), 'rooms never handle Login IDs');
  console.log('PASS: Task 19 rooms (public and private rooms, chat, room games, live spectators, comments, match invites).');
}
// Applied migrations never re-run: only Migration 023's own files trigger it; 019-022 are manual only.
{
  const { readFileSync } = await import('node:fs');
  for (const n of ['019', '020', '021', '022']) {
    const wf = readFileSync(new URL(`../.github/workflows/apply-migration-${n}.yml`, import.meta.url), 'utf8');
    assert(!/^\s+push:/m.test(wf), `Migration ${n} workflow has no push trigger`);
  }
  const wf23 = readFileSync(new URL('../.github/workflows/apply-migration-023.yml', import.meta.url), 'utf8');
  assert(!wf23.includes("- 'tests/db-migrations.mjs'") && !wf23.includes("- 'scripts/lib/guarded-migration.mjs'"), 'Migration 023 does not run on shared file changes');
  console.log('PASS: applied migrations 019-022 never re-run; 023 runs only on its own files.');
}
// Task 19: room voice messages (24 hours) and direct calls/files between online friends with sealed signals.
{
  const { readFileSync } = await import('node:fs');
  const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
  const E = await import('../src/e2ee.js');
  const st = E.memoryStore(), a = await E.deviceKey(st, 'a'), b = await E.deviceKey(st, 'b'), eve = await E.deviceKey(st, 'e');
  const rejects = async f => { try { await f(); return false; } catch { return true; } };
  const sdp = 'v=0\r\n' + 'a=fingerprint:sha-256 AB:CD\r\n'.repeat(200);
  const boxes = await E.sealData({ t: 'offer', sdp }, a, [b]);
  assert.equal((await E.openData(boxes[b.deviceId], b, a.deviceId, a.publicKey)).sdp, sdp, 'sealed connection description opens on the friend\'s device');
  assert(await rejects(() => E.openData(boxes[b.deviceId], b, a.deviceId, eve.publicKey)), 'a forged sender is rejected');
  assert(await rejects(() => E.open(boxes[b.deviceId], b, a.deviceId, a.publicKey)), 'a signal can never be read as a chat message');
  assert(await rejects(() => E.openData(boxes[b.deviceId], b, a.deviceId, a.publicKey, Date.now() + 600000)), 'old signals cannot be replayed');
  const html = read('../index.html'), main = read('../src/main.js'), rooms = read('../src/rooms.js'), direct = read('../src/direct.js'), api = read('../supabase/functions/blind-quiz-api/index.ts');
  for (const id of ['room-voice-record', 'room-voice-cancel', 'direct-call-audio', 'direct-call-video', 'direct-send-file', 'direct-file-input', 'direct-panel', 'direct-progress', 'direct-remote', 'direct-local']) assert(html.includes(`id="${id}"`), `markup #${id}`);
  assert(!/startCall|createDirect|RTCPeerConnection/.test(rooms), 'rooms have no calls, only voice messages');
  assert(/'room-voice-send':\['bq_room_voice_send'/.test(api) && /'signal-send':\['bq_signal_send'/.test(api) && /'signals':\['bq_signals_poll'/.test(api), 'voice and signal API actions');
  assert(/sealData\(\{ \.\.\.obj, s: sess\.id \}, me, targets\)/.test(direct) && !/callApi\('signal-send', \{[^}]*sdp/.test(direct), 'only sealed boxes carry connection details');
  assert(!/turn:/i.test(direct), 'no paid relay server is used');
  assert(/direct\.startFile\(chat\.friend,f\)/.test(main) && /onRing:\(\)=>direct\.poll\(\)/.test(main), 'files and calls start from the friend chat; heartbeat rings');
  console.log('PASS: Task 19 room voice messages and direct calls/files between online friends (sealed signals: open, forged sender, cross-use and replay rejected).');
}
// Task 19 stage E: exit confirmation for games, modes and rooms (buttons, brand link and Android/browser Back).
{
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert(/function go\(view,opts=\{\}\)\{if\(!opts\.confirmed&&needsExitConfirm\(view\)\)/.test(main) && /function onHistory\(e\)\{[^\n]*needsExitConfirm\(v\)/.test(main), 'every way out of a game asks first, including Back');
  assert(/game:\['Exit this quiz\?'/.test(main) && /letters:\['Exit Letters to Words\?'/.test(main) && /soundmatch:\['Exit Sound Match\?'/.test(main) && /room:\['Leave this room\?'/.test(main) && /view!=='results'/.test(main), 'quiz, Letters, Sound Match and rooms are protected; finishing a round never asks');
  assert(/role="alertdialog" aria-modal="true" aria-labelledby="exit-title" aria-describedby="exit-text"/.test(html) && html.includes('id="exit-stay"') && html.includes('id="exit-leave"'), 'accessible exit dialog');
  console.log('PASS: Task 19 exit confirmation (games, modes, rooms; buttons, logo and Back).');
}
