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
await writeFile(new URL('download/audio-studio.html',out),stamp(html).replace('<meta charset="utf-8">','<meta charset="utf-8">\n  <base href="../">'));
await writeFile(new URL('sw.js',out),stamp(await readFile(new URL('../sw.js',import.meta.url),'utf8')));
await writeFile(new URL('version.json',out),JSON.stringify({build,built})+'\n');
console.log(`Production static build written to dist/ (build ${build}).`);
