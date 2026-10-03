const CACHE='blind-quiz-shell-v2';
const SHELL=['./','./index.html','./styles.css','./manifest.webmanifest','./src/main.js','./src/content.js','./src/expansion-questions.js','./src/random.js','./src/backend.js','./src/config.js','./assets/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy));return res}).catch(()=>caches.match('./index.html')));return;}
 event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok&&url.origin===self.location.origin)caches.open(CACHE).then(c=>c.put(req,res.clone()));return res})));
});
