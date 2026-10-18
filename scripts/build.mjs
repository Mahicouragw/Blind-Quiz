import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { validateQuestionBank } from '../src/content.js';

const errors=validateQuestionBank();
if(errors.length)throw new Error(errors.join('\n'));
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
for(const asset of ['styles.css','manifest.webmanifest','src/main.js','assets/icon.svg']){
  if(!html.includes(asset))throw new Error(`index.html does not reference ${asset}`);
}
for(const page of ['privacy-policy.html','terms-and-conditions.html']){
  if(!html.includes(`href="${page}"`))throw new Error(`index.html does not link ${page}`);
  const legal=await readFile(new URL(`../${page}`,import.meta.url),'utf8');
  if(!legal.includes('<main id="main"')||!legal.includes('Content-Security-Policy'))throw new Error(`${page} is incomplete`);
}
const out=new URL('../dist/',import.meta.url);
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
for(const path of ['replay.html','news.json','privacy-policy.html','terms-and-conditions.html','styles.css','manifest.webmanifest','AUDIO_LICENSES.md','licenses','assets','src','supabase/functions/_shared']){
  await cp(new URL(`../${path}`,import.meta.url),new URL(path,out),{recursive:true,filter:src=>!src.includes('/assets/audio/incoming')});
}
// Every build is stamped, so the page can tell which build is live and the offline copy of an
// older build is never reused.
const build=process.env.GITHUB_SHA||(()=>{try{return execFileSync('git',['rev-parse','--short','HEAD'],{cwd:new URL('..',import.meta.url).pathname,encoding:'utf8'}).trim()}catch{return 'local'}})();
const built=new Date().toISOString();
const stamp=(text)=>text.replaceAll('__BQ_BUILD__',build);
await writeFile(new URL('index.html',out),stamp(html));
await mkdir(new URL('download/',out),{recursive:true});
const studioHtml=`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data: blob: https://zchircgdkyjnowqcdwvf.supabase.co; connect-src 'self' https://zchircgdkyjnowqcdwvf.supabase.co; base-uri 'self'; form-action 'none'">
  <title>Blind Quiz — Sound Effects Uploader</title>
  <link rel="stylesheet" href="../styles.css">
</head>
<body style="padding:16px;max-width:680px;margin:0 auto">
  <main id="main" class="panel" style="display:block">
    <h1>Blind Quiz — Direct Sound Uploader</h1>
    <p class="muted">Pick your audio files below. Each file automatically publishes live to all players the moment you select it, and plays back so you can hear it.</p>

    <section class="inbox-box" style="margin-top:16px;padding:16px;border:2px solid #ffd84d;border-radius:12px">
      <h2>1. First File — Level Up Sound</h2>
      <label class="field-label" for="file-levelup">Choose Level Up audio file (MP3, WAV, M4A, OGG)</label>
      <input id="file-levelup" class="text-input" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm">
      <div class="button-row" style="margin-top:10px">
        <button id="btn-levelup" class="primary-btn" type="button">Publish Level Up Sound</button>
      </div>
      <p id="status-levelup" class="muted" role="status" aria-live="polite">Waiting for Level Up file…</p>
    </section>

    <section class="inbox-box" style="margin-top:16px;padding:16px;border:2px solid #ffd84d;border-radius:12px">
      <h2>2. Second File — Round Completion Sound</h2>
      <label class="field-label" for="file-roundcomplete">Choose Round Completion audio file (MP3, WAV, M4A, OGG)</label>
      <input id="file-roundcomplete" class="text-input" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm">
      <div class="button-row" style="margin-top:10px">
        <button id="btn-roundcomplete" class="primary-btn" type="button">Publish Round Completion Sound</button>
      </div>
      <p id="status-roundcomplete" class="muted" role="status" aria-live="polite">Waiting for Round Completion file…</p>
    </section>

    <section class="inbox-box" style="margin-top:16px;padding:16px">
      <h2>3. Any Other Sound or Music Slot</h2>
      <label class="field-label" for="slot-any">Sound or music slot</label>
      <select id="slot-any" class="text-input">
        <option value="countdown">3, 2, 1 countdown beep</option>
        <option value="tick">Question timer tick (every second)</option>
        <option value="tick_last">Final 5 seconds urgent tick</option>
        <option value="click">Button click / tap</option>
        <option value="swipe">Swipe / focus move</option>
        <option value="levelup">Level up (all games &amp; modes)</option>
        <option value="roundcomplete">Round finish / Round completed</option>
        <option value="go">Round start (GO)</option>
        <option value="correct">Correct answer</option>
        <option value="wrong">Wrong answer</option>
        <option value="timeup">Time up buzzer</option>
        <option value="hurry">10 seconds left warning</option>
        <option value="coin">Coin reward</option>
        <option value="streak">Streak fanfare</option>
        <option value="notify">Notification chime</option>
        <option value="applause">Applause</option>
        <option value="cheer">Victory cheer</option>
        <option value="music_menu">Background music: Home &amp; menus</option>
        <option value="music_game1">Background music: Track 1</option>
        <option value="music_game2">Background music: Track 2</option>
        <option value="music_game3">Background music: Track 3</option>
        <option value="music_results">Background music: Results screen</option>
      </select>
      <label class="field-label" for="file-any" style="margin-top:8px">Choose audio file</label>
      <input id="file-any" class="text-input" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm">
      <div class="button-row" style="margin-top:10px">
        <button id="btn-any" class="primary-btn" type="button">Publish Selected Slot</button>
      </div>
      <p id="status-any" class="muted" role="status" aria-live="polite">Ready.</p>
    </section>
  </main>
  <script>
  (function(){
    var API='https://zchircgdkyjnowqcdwvf.supabase.co/functions/v1/blind-quiz-api';
    var KEY='sb_publishable_raQlRdkDriEGoGj0iZ3ZhQ_e6CofOfM';
    var picked={};
    function speak(msg){
      try{if(window.speechSynthesis){window.speechSynthesis.cancel();window.speechSynthesis.speak(new SpeechSynthesisUtterance(msg))}}catch(e){}
    }
    function readDataUrl(file){
      return new Promise(function(resolve,reject){
        var r=new FileReader();
        r.onload=function(){resolve(String(r.result||''))};
        r.onerror=function(){reject(new Error('Could not read file'))};
        r.readAsDataURL(file);
      });
    }
    async function publishSlot(slot,label,fileInput,btn,statusEl){
      var f=fileInput.files&&fileInput.files[0];
      if(f){
        try{picked[slot]={fileName:f.name||(slot+'.mp3'),dataUrl:await readDataUrl(f)}}catch(e){statusEl.textContent='Could not read file.';speak(statusEl.textContent);return}
      }
      var cur=picked[slot];
      if(!cur||!cur.dataUrl){statusEl.textContent='Please choose an audio file first.';speak(statusEl.textContent);fileInput.click();return}
      btn.disabled=true;btn.textContent='Publishing…';
      statusEl.textContent='Publishing '+label+' ('+cur.fileName+') to all players…';
      try{
        var r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY},body:JSON.stringify({action:'admin-audio',op:'publish',slot:slot,fileName:cur.fileName,dataUrl:cur.dataUrl,adminKey:'KTLXTPM2'})});
        var data=await r.json();
        if(!r.ok||!data||data.ok===false)throw new Error((data&&data.code)||('HTTP '+r.status));
        try{
          var map=JSON.parse(localStorage.getItem('bq.audioOverrides.v1')||'{}');
          map[slot]=data.entry||{url:cur.dataUrl,fileName:cur.fileName,updatedAt:new Date().toISOString()};
          localStorage.setItem('bq.audioOverrides.v1',JSON.stringify(map));
        }catch(e){}
        try{new Audio(cur.dataUrl).play()}catch(e){}
        btn.textContent='Published ✓';
        var msg='Published '+label+' ('+cur.fileName+') live to all players!';
        statusEl.textContent=msg;speak(msg);
      }catch(err){
        btn.textContent='Publish Failed — Tap to Retry';
        var emsg='Upload failed: '+(err&&err.message?err.message:'error');
        statusEl.textContent=emsg;speak(emsg);
      }finally{btn.disabled=false}
    }
    function wire(slotGetter,labelGetter,fileId,btnId,statusId){
      var fileInput=document.getElementById(fileId),btn=document.getElementById(btnId),statusEl=document.getElementById(statusId);
      fileInput.addEventListener('change',function(){publishSlot(slotGetter(),labelGetter(),fileInput,btn,statusEl)});
      btn.addEventListener('click',function(){publishSlot(slotGetter(),labelGetter(),fileInput,btn,statusEl)});
    }
    wire(function(){return 'levelup'},function(){return 'Level Up sound'},'file-levelup','btn-levelup','status-levelup');
    wire(function(){return 'roundcomplete'},function(){return 'Round Completion sound'},'file-roundcomplete','btn-roundcomplete','status-roundcomplete');
    var slotSel=document.getElementById('slot-any');
    wire(function(){return slotSel.value},function(){return slotSel.options[slotSel.selectedIndex].text},'file-any','btn-any','status-any');
    var p=new URLSearchParams((location.hash||'').replace(/^#/,''));
    var s=p.get('slot');if(s&&slotSel)slotSel.value=s;
  })();
  </script>
</body>
</html>`;
await writeFile(new URL('download/audio-studio.html',out),studioHtml);
await writeFile(new URL('sw.js',out),stamp(await readFile(new URL('../sw.js',import.meta.url),'utf8')));
await writeFile(new URL('version.json',out),JSON.stringify({build,built})+'\n');
console.log(`Production static build written to dist/ (build ${build}).`);
