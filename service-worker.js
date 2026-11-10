/* One PWA service worker. Bump version on each release. */
const CACHE_VERSION="one-shell-v13",ASSET_CACHE="one-assets-v13";
const PRECACHE=["./","./index.html","./styles.css","./app.js","./auth.js","./voice-assistant.js","./document-extractor.js","./manifest.json","./icons/student-brain.svg"];
const OFFLINE_PAGE="./index.html";
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(PRECACHE))));
self.addEventListener("activate",e=>e.waitUntil((async()=>{const keep=new Set([CACHE_VERSION,ASSET_CACHE]);const keys=await caches.keys();await Promise.all(keys.filter(k=>/^(one-shell-|one-assets-|student-brain-shell-)/.test(k)&&!keep.has(k)).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener("message",e=>{if(e.data?.type==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.origin!==self.location.origin)return;
if(r.mode==="navigate"||r.destination==="document"){e.respondWith((async()=>{try{const response=await fetch(r,{cache:"no-store"});if(response.ok){const c=await caches.open(CACHE_VERSION);c.put(OFFLINE_PAGE,response.clone()).catch(()=>{})}return response}catch{return(await caches.match(r))||(await caches.match(OFFLINE_PAGE))||Response.error()}})());return}
if(/\.(?:css|js|mjs|json|svg|png|webp|ico|woff2?)$/i.test(u.pathname)){e.respondWith((async()=>{const c=await caches.open(ASSET_CACHE);try{const response=await fetch(r,{cache:"no-cache"});if(response.ok)c.put(r,response.clone()).catch(()=>{});return response}catch{return(await c.match(r))||(await caches.match(r))||Response.error()}})())}
});