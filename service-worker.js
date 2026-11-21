/* One PWA service worker. Bump version on each release. */
const CACHE_VERSION="one-shell-v44",ASSET_CACHE="one-assets-v44";
const PRECACHE=["./","./index.html","./404.html","./supabase-client.js","./pwa-init.js","./analytics.js","./workspace-intelligence.js","./styles.css","./quality-guardrails.css","./kuro-theme.css","./kuro-theme-init.js","./kuro-shell.js","./app.js","./commands.js","./one-commands.js","./voice.js","./auth.js","./voice-assistant.js","./document-extractor.js","./manifest.json","./ui-visibility.css","./ask-one-page-fix.css","./profile.css","./group-trip.js","./profile.js","./ask-one-command-ui.js","./ask-one-reply-actions.js","./icons/student-brain.svg"];
const OFFLINE_PAGE="./index.html";
const SHELL_PRECACHE=["./","./index.html","./404.html"];
const ASSET_PRECACHE=PRECACHE.filter(path=>!SHELL_PRECACHE.includes(path));
self.addEventListener("install",e=>e.waitUntil((async()=>{
 await Promise.all([
  caches.open(CACHE_VERSION).then(cache=>cache.addAll(SHELL_PRECACHE)),
  caches.open(ASSET_CACHE).then(cache=>cache.addAll(ASSET_PRECACHE))
 ]);
})()));
self.addEventListener("activate",e=>e.waitUntil((async()=>{const keep=new Set([CACHE_VERSION,ASSET_CACHE]);const keys=await caches.keys();await Promise.all(keys.filter(k=>/^(one-shell-|one-assets-|student-brain-shell-)/.test(k)&&!keep.has(k)).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener("message",e=>{if(e.data?.type==="SKIP_WAITING")self.skipWaiting()});
function safeShareUrl(value){try{const url=new URL(String(value||''),self.location.origin);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''}catch(_){return ''}}
async function saveSharePayload(payload){
 return await new Promise((resolve,reject)=>{
  const request=indexedDB.open("one-share-inbox",1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("captures"))db.createObjectStore("captures",{keyPath:"id"})};
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction("captures","readwrite");tx.objectStore("captures").put(payload);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();reject(tx.error)}};
 });
}
self.addEventListener("fetch",e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method==="POST"&&u.origin===self.location.origin&&u.pathname.endsWith("/share/")){
  e.respondWith((async()=>{
   try{
    const form=await r.formData(),rawFiles=form.getAll("shared_files").filter(x=>x instanceof File&&x.size>0);
    let totalBytes=0;
    const files=rawFiles.filter(file=>{
     const validType=['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type);
     if(!validType||file.size>12*1024*1024)return false;
     totalBytes+=file.size;return totalBytes<=20*1024*1024;
    }).map(file=>({name:String(file.name||'Shared file').replace(/[\\/\\0-\\x1f]/g,'_').slice(0,180),type:file.type,size:file.size,blob:file}));
    const payload={id:Date.now()+"-"+Math.random().toString(36).slice(2),title:String(form.get("title")||"").slice(0,300),text:String(form.get("text")||"").slice(0,12000),url:safeShareUrl(form.get("url")),files,createdAt:Date.now()};
    await saveSharePayload(payload);
    return Response.redirect(new URL("./?shared=1",self.registration.scope),303);
   }catch(error){return new Response("One could not receive this shared item. Please open One and try again.",{status:500,headers:{"Content-Type":"text/plain; charset=utf-8"}})}
  })());
  return;
 }
 if(r.method!=="GET")return;
 if(u.origin!==self.location.origin)return;
if(r.mode==="navigate"||r.destination==="document"){e.respondWith((async()=>{try{const response=await fetch(r,{cache:"no-store"});if(response.ok){const c=await caches.open(CACHE_VERSION);c.put(OFFLINE_PAGE,response.clone()).catch(()=>{})}return response}catch{return(await caches.match(r))||(await caches.match(OFFLINE_PAGE))||Response.error()}})());return}
if(/\.(?:css|js|mjs|json|svg|png|webp|ico|woff2?)$/i.test(u.pathname)){e.respondWith((async()=>{const c=await caches.open(ASSET_CACHE);try{const response=await fetch(r,{cache:"no-cache"});if(response.ok)c.put(r,response.clone()).catch(()=>{});return response}catch{return(await c.match(r))||(await caches.match(r))||Response.error()}})())}
});
self.addEventListener("push",event=>{
 let payload={title:"One · Reminder",body:"You have a task reminder.",url:"./"};
 try{if(event.data)payload={...payload,...event.data.json()}}catch(_){try{payload.body=event.data?.text()||payload.body}catch(__){}}
 event.waitUntil(self.registration.showNotification(payload.title||"One · Reminder",{
  body:payload.body||"You have a reminder.",icon:"./icons/student-brain.svg",badge:"./icons/student-brain.svg",
  tag:payload.tag||"one-push-"+Date.now(),renotify:false,data:{url:safeShareUrl(payload.url)||"./"}
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const requested=safeShareUrl(event.notification.data?.url||"./"),target=requested&&new URL(requested).origin===self.location.origin?requested:new URL("./",self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if("focus" in client){await client.focus();client.navigate?.(target);return}}
  if(self.clients.openWindow)await self.clients.openWindow(target);
 })());
});
