/* One PWA service worker. Bump version on each release. */
const CACHE_VERSION="one-shell-v18",ASSET_CACHE="one-assets-v18";
const PRECACHE=["./","./index.html","./styles.css","./app.js","./auth.js","./voice-assistant.js","./document-extractor.js","./manifest.json","./icons/student-brain.svg"];
const OFFLINE_PAGE="./index.html";
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE_VERSION).then(c=>c.addAll(PRECACHE))));
self.addEventListener("activate",e=>e.waitUntil((async()=>{const keep=new Set([CACHE_VERSION,ASSET_CACHE]);const keys=await caches.keys();await Promise.all(keys.filter(k=>/^(one-shell-|one-assets-|student-brain-shell-)/.test(k)&&!keep.has(k)).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener("message",e=>{if(e.data?.type==="SKIP_WAITING")self.skipWaiting()});
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
    const form=await r.formData(),files=form.getAll("shared_files").filter(x=>x instanceof File&&x.size>0).map(file=>({name:file.name,type:file.type,size:file.size,blob:file}));
    const payload={id:Date.now()+"-"+Math.random().toString(36).slice(2),title:String(form.get("title")||""),text:String(form.get("text")||""),url:String(form.get("url")||""),files,createdAt:Date.now()};
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
  tag:payload.tag||"one-push-"+Date.now(),renotify:false,data:{url:payload.url||"./"}
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||"./",self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows){if("focus" in client){await client.focus();client.navigate?.(target);return}}
  if(self.clients.openWindow)await self.clients.openWindow(target);
 })());
});
