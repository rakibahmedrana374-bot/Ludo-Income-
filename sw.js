const CACHE='ludo-income-v2';
const SHELL=['/','/index.html','/manifest.json','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/api/')||new URL(e.request.url).pathname.startsWith('/uploads/')) return; e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
