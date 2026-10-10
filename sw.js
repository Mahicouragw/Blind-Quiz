const CACHE='blind-quiz-shell-v24';
const SHELL=['./','./index.html','./styles.css','./manifest.webmanifest','./src/main.js','./src/content.js','./src/expansion-questions.js','./src/expansion-questions-025.js','./src/expansion-questions-025-a.js','./src/expansion-questions-025-b.js','./src/expansion-questions-025-c.js','./src/expansion-questions-025-d.js','./src/expansion-questions-025-e.js','./src/game-logic.js','./src/random.js','./src/backend.js','./src/audio.js','./src/words.js','./src/short-words.js','./src/letters.js','./src/letters-ui.js','./src/meanings.js','./src/questions-016.js','./src/feedback.js','./src/social.js','./src/chat.js','./src/rooms.js','./src/direct.js','./src/alerts.js','./src/e2ee.js','./src/sound-match.js','./src/sound-match-ui.js','./src/config.js','./assets/icon.svg','./privacy-policy.html','./terms-and-conditions.html','./src/legal.js','./assets/fonts/atkinson-hyperlegible-latin-400-normal.woff2','./assets/fonts/atkinson-hyperlegible-latin-700-normal.woff2','./assets/fonts/bungee-latin-400-normal.woff2'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Network-first: returning players always get the latest main.js and content.js when online.
// The cache is only consulted inside .catch(), i.e. when the network is unavailable.
self.addEventListener('fetch',event=>{
 const req=event.request;const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/download/'))return; // the APK download is never cached
 event.respondWith(fetch(req).then(res=>{if(res.status===200){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req.mode==='navigate'?'./index.html':req,copy))}return res}).catch(()=>caches.match(req).then(hit=>hit||(req.mode==='navigate'?caches.match('./index.html'):undefined))));
});
