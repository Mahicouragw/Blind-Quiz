import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUESTION_BANK, CATEGORY_LIST, STARTER_QUESTION_COUNT, MIGRATION_009_COUNT, validateQuestionBank } from '../src/content.js';
import { shuffled } from '../src/random.js';

assert.deepEqual(validateQuestionBank(),[],'question pack validation');
assert.equal(STARTER_QUESTION_COUNT,73,'historical starter IDs stay stable');
assert.equal(QUESTION_BANK.length,825,'73 starter plus 752 expansion questions (252 in Migration 009, 200 in Migration 010, 200 in Migration 011, 100 in Migration 015)');
assert.equal(MIGRATION_009_COUNT,252,'Migration 009 keeps its 252 rows');
assert.equal(CATEGORY_LIST.length,25,'20 established categories plus Medical, Math, Physics, Chemistry and Biology');
const NEW_CATS=['medical','math','physics','chemistry','biology'];
assert.deepEqual(CATEGORY_LIST.slice(20).map(c=>c.id),NEW_CATS,'five new categories');
for(const c of CATEGORY_LIST.slice(20))assert.equal(c.count,20,`${c.id} has 20 questions`);
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
assert.equal(QUESTION_BANK.at(-1).id,'bq-en-1166','final expansion ID');
assert.equal(QUESTION_BANK.length-STARTER_QUESTION_COUNT,752,'752 expansion questions');
for(const category of CATEGORY_LIST.slice(0,20)){
  const added=QUESTION_BANK.slice(325,525).filter(q=>q.category===category.id);
  assert.equal(added.length,10,`${category.id} has 10 Migration 010 questions`);
  const added011=QUESTION_BANK.slice(525,725).filter(q=>q.category===category.id);
  assert.equal(added011.length,10,`${category.id} has 10 Migration 011 questions`);
}
const normPrompt=s=>s.toLowerCase().replace(/[’']/g,"'").replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
assert.equal(new Set(QUESTION_BANK.map(q=>normPrompt(q.question))).size,QUESTION_BANK.length,'no duplicate prompts across all 825 questions');
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
const SFX_SLOTS=['correct','wrong','tick','go','timeup','applause','cheer','click','levelup','coin'];
assert.deepEqual(Object.keys(stockSrc.sfx).sort(),[...SFX_SLOTS].sort(),'every sound effect is pinned to a Mixkit asset');
for(const [slot,pin] of Object.entries(stockSrc.sfx))assert(Number.isInteger(pin.mixkitId)&&pin.title&&pin.category&&pin.max>0&&pin.max<=8,`${slot}: Mixkit pin is complete`);
assert.deepEqual(Object.keys(stockSrc.music),['menu','game1','game2','game3','results'],'five music slots');
const audioBuilder=await readFile(new URL('../scripts/audio/stock-audio.mjs',import.meta.url),'utf8');
assert(!/fetch\([^)]*pixabay/i.test(audioBuilder)&&audioBuilder.includes('assets.mixkit.co/active_storage/sfx/')&&!/mixkit\.co\/free-stock-music/.test(audioBuilder),'Mixkit sound effects only; Pixabay music is never fetched automatically; no Mixkit music');
const MIXKIT=/^Mixkit Sound Effects Free License$/,PIXABAY=/^Pixabay Content License$/,COMMONS=/^(CC0|Public domain)$/i;
for(const slot of [...SFX_SLOTS,'music_menu','music_game1','music_game2','music_game3','music_results']){const a=audioManifest.assets[slot];
  const ok=a&&((a.provider==='Mixkit'&&MIXKIT.test(a.licence)&&a.kind==='sfx'&&/^https:\/\/mixkit\.co\/free-sound-effects\//.test(a.source))
    ||(a.provider==='Pixabay'&&PIXABAY.test(a.licence)&&a.kind==='music'&&/^https:\/\/pixabay\.com\/music\//.test(a.source))
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
assert(!/category-mark|category-count|c\.description|c\.count/.test(categoryRender),'category buttons show names only');
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
assert(sw.includes("const CACHE='blind-quiz-shell-v12'"),'service worker cache is v12');
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
  for(let i=1;i<LEVELS.length;i++){const a=LEVELS[i-1],b=LEVELS[i];assert(b.goal>a.goal&&b.letters>=a.letters&&(b.letters>a.letters||b.seedTiers.length>a.seedTiers.length),`level ${i+1} is harder than level ${i}`);assert(Number.isFinite(a.xp)&&a.xp>0,'every level below the top has an XP target');assert(a.name&&a.describe,'levels have a name and description')}
  assert.equal(LEVELS[0].letters,4);assert.equal(MAX_LEVEL,LEVELS.length);
  assert.deepEqual(['of','too','word','lights','letters'].map(wordXp),[1,2,3,5,6],'word XP matches bq_record_word (2 letters 1 XP, else 2-6 by length)');
  assert.deepEqual(applyLevelXp(1,28,roundBonus(1)),{level:2,levelXp:0,levelledUp:true},'level-up is automatic when the target is reached');
  assert.deepEqual(applyLevelXp(1,0,9),{level:1,levelXp:9,levelledUp:false});
  assert.equal(applyLevelXp(MAX_LEVEL,10,5).level,MAX_LEVEL,'no level beyond the top');
  const ui=await readFile(new URL('../src/letters-ui.js',import.meta.url),'utf8');
  assert(/playSequence\(res\.levelledUp \|\| profileUp \? \['applause', 'levelup'\] : \['applause'\]\)/.test(ui),'round sound, then the level-up sound');
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

