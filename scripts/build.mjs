import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { validateQuestionBank } from '../src/content.js';

const errors=validateQuestionBank();
if(errors.length)throw new Error(errors.join('\n'));
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
for(const asset of ['styles.css','manifest.webmanifest','src/main.js','assets/icon.svg']){
  if(!html.includes(asset))throw new Error(`index.html does not reference ${asset}`);
}
const out=new URL('../dist/',import.meta.url);
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
for(const path of ['index.html','styles.css','manifest.webmanifest','sw.js','assets','src']){
  await cp(new URL(`../${path}`,import.meta.url),new URL(path,out),{recursive:true});
}
console.log('Production static build written to dist/.');
