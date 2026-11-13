const KEY='student-brain-data-v1';
let activeWorkspaceUserId=null;
let activeWorkspaceKey=KEY+'-guest';
const LEGACY_OWNER_KEY=KEY+'-legacy-claimed-by';
function workspaceStorageKey(){return activeWorkspaceKey;}
function workspaceIndexedDBKey(){return 'workspace:'+activeWorkspaceKey;}
const DATA_SCHEMA_VERSION=3;
const starter=()=>({schemaVersion:DATA_SCHEMA_VERSION,notes:[],tasks:[],projects:[],people:[],expenses:[],moneyBudgets:[],messages:[],studySessions:[],documents:[],memories:[],notifications:[],aiPrivacy:{notes:true,tasks:true,projects:true,documents:true,money:false,memories:true}});
function migrateData(raw){
 const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const next={...starter(),...source};
 for(const key of ['notes','tasks','projects','people','expenses','moneyBudgets','messages','studySessions','documents','memories','notifications'])if(!Array.isArray(next[key]))next[key]=[];
 next.aiPrivacy={notes:true,tasks:true,projects:true,documents:true,money:false,memories:true,...(source.aiPrivacy&&typeof source.aiPrivacy==='object'?source.aiPrivacy:{})};
 next.schemaVersion=DATA_SCHEMA_VERSION;
 return next;
}
try{if(!localStorage.getItem(LEGACY_OWNER_KEY)&&!localStorage.getItem(KEY+'-guest')&&localStorage.getItem(KEY))localStorage.setItem(KEY+'-guest',localStorage.getItem(KEY))}catch(error){console.warn("Operation failed; diagnostic details redacted.")}
let data=loadData(),page='overview',chatBusy=false,pendingChatAction=null;
let cloudClient=null,cloudUser=null,cloudReady=false;
const CLOUD_URL='https://tcthrfpkydcmenxwajfg.supabase.co';
const CLOUD_KEY='sb_publishable_-PlVhv38rbHYFqsfvJ42AQ_S6-2A7JT';

const AI_FILES_DB='student-brain-files-v1';
let studentBrainAIClient=null,studentBrainAITokenPromise=null;
function getStudentBrainAIClient(){
 if(studentBrainAIClient)return studentBrainAIClient;
 if(!window.supabase?.createClient)throw new Error('Supabase client did not load. Refresh and try again.');
 studentBrainAIClient=window.supabase.createClient(CLOUD_URL,CLOUD_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'student-brain-ai-auth-v1'}});
 return studentBrainAIClient;
}
async function getStudentBrainAIToken(){
 const client=getStudentBrainAIClient(),current=await client.auth.getSession();
 if(current.error)throw current.error;
 if(current.data.session?.access_token)return current.data.session.access_token;
 if(studentBrainAITokenPromise)return studentBrainAITokenPromise;
 studentBrainAITokenPromise=(async()=>{
  throw new Error('Please sign in to use One.');
 })();
 try{return await studentBrainAITokenPromise}finally{studentBrainAITokenPromise=null}
}
async function purgeUserLocalData(userId){
 if(!userId)return false;
 const key=KEY+'-user-'+userId;
 let snapshot={};try{snapshot=JSON.parse(localStorage.getItem(key)||'{}')}catch(_){}
 const fileIds=(snapshot.documents||[]).map(d=>d?.id).filter(Boolean);
 try{
  const db=await openAIFileDB();
  await new Promise((resolve,reject)=>{
   const tx=db.transaction(['files','workspace'],'readwrite');
   const files=tx.objectStore('files');for(const id of fileIds)files.delete(id);
   tx.objectStore('workspace').delete('workspace:'+key);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });db.close();
 }catch(error){console.warn("Operation failed; diagnostic details redacted.");throw error}
 for(const suffix of ['', '-last-good','-pending-cloud','-idb-migrated-at','-sync-meta','-sync-meta-'+userId]){try{localStorage.removeItem(key+suffix)}catch(_){}}
 return true;
}
function openAIFileDB(){
 return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(new Error('This browser does not support local file storage.'));return}
  const req=indexedDB.open(AI_FILES_DB,2);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'id'});if(!db.objectStoreNames.contains('workspace'))db.createObjectStore('workspace',{keyPath:'key'})};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error('Could not open local file storage.'));
 });
}
async function saveOriginalDocument(id,file){
 const db=await openAIFileDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('files','readwrite');
  tx.objectStore('files').put({id,name:file.name,type:file.type||'',size:file.size,blob:file,updated:Date.now()});
  tx.oncomplete=()=>{db.close();resolve(true)};
  tx.onerror=()=>{const err=tx.error||new Error('Could not save original file.');db.close();reject(err)};
  tx.onabort=()=>{const err=tx.error||new Error('Local file save was cancelled.');db.close();reject(err)};
 });
}
async function getOriginalDocument(id){
 const db=await openAIFileDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('files','readonly'),req=tx.objectStore('files').get(id);
  req.onsuccess=()=>{db.close();resolve(req.result||null)};
  req.onerror=()=>{const err=req.error||new Error('Could not read original file.');db.close();reject(err)};
 });
}
async function removeOriginalDocument(id){
 try{const db=await openAIFileDB();await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}catch(err){console.warn("Operation failed; diagnostic details redacted.")}
}
async function fileToBase64(blob){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>{const value=String(reader.result||''),comma=value.indexOf(',');resolve(comma>=0?value.slice(comma+1):'')};reader.onerror=()=>reject(reader.error||new Error('Could not read original file.'));reader.readAsDataURL(blob);
 });
}

const WORKSPACE_STORE_KEY='latest';
let workspaceWriteQueue=Promise.resolve();
function saveWorkspaceSnapshot(snapshot){
 const safeCopy=JSON.parse(JSON.stringify(migrateData(snapshot)));
 const snapshotKey=workspaceIndexedDBKey();
 workspaceWriteQueue=workspaceWriteQueue.catch(()=>{}).then(async()=>{
  const db=await openAIFileDB();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('workspace','readwrite');
   tx.objectStore('workspace').put({key:snapshotKey,data:safeCopy,savedAt:Date.now(),schemaVersion:DATA_SCHEMA_VERSION});
   tx.oncomplete=()=>{db.close();resolve(true)};
   tx.onerror=()=>{const err=tx.error||new Error('IndexedDB write failed');db.close();reject(err)};
   tx.onabort=()=>{const err=tx.error||new Error('IndexedDB write was aborted');db.close();reject(err)};
  });
 });
 return workspaceWriteQueue;
}
async function readWorkspaceSnapshot(){
 const db=await openAIFileDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('workspace','readonly'),req=tx.objectStore('workspace').get(workspaceIndexedDBKey());
  req.onsuccess=()=>{db.close();resolve(req.result||null)};
  req.onerror=()=>{const err=req.error||new Error('IndexedDB read failed');db.close();reject(err)};
 });
}
async function migrateWorkspaceToIndexedDB(){
 try{
  const saved=await readWorkspaceSnapshot();
  const current=JSON.parse(localStorage.getItem(workspaceStorageKey())||'{}');
  const currentData=migrateData(current);
  // Only seed/migrate if the IndexedDB copy is absent or older. Never overwrite
  // a newer durable copy with stale localStorage content.
  if(!saved||Number(saved.savedAt||0)<Number(localStorage.getItem(workspaceStorageKey()+'-idb-migrated-at')||0)){
   await saveWorkspaceSnapshot(currentData);
  }
  localStorage.setItem(workspaceStorageKey()+'-idb-migrated-at',String(Date.now()));
  window.studentBrainStorageHealth={state:'ready',message:'IndexedDB safety copy active'};
 }catch(err){
  console.warn("Operation failed; diagnostic details redacted.");
  window.studentBrainStorageHealth={state:'warning',message:err.message||'IndexedDB unavailable'};
 }
}
async function requestWorkspaceStoragePersistence(){
 try{
  if(navigator.storage?.persist)window.studentBrainStoragePersistent=await navigator.storage.persist();
  if(navigator.storage?.estimate)window.studentBrainStorageEstimate=await navigator.storage.estimate();
 }catch(err){console.warn("Operation failed; diagnostic details redacted.")}
}
function loadData(){
 try{return migrateData(JSON.parse(localStorage.getItem(workspaceStorageKey())||'{}'))}
 catch(primaryError){
  try{const lastGood=localStorage.getItem(workspaceStorageKey()+'-last-good');if(lastGood){console.warn("Operation failed; diagnostic details redacted.");return migrateData(JSON.parse(lastGood))}}
  catch(recoveryError){console.warn("Operation failed; diagnostic details redacted.")}
  console.warn("Operation failed; diagnostic details redacted.");return starter();
 }
}
let syncQueue=Promise.resolve();
let cloudRetryTimer=null,cloudRetryDelay=1500,lastSyncedAt=null,cloudMode='offline',cloudLastError='';
function syncMetaKey(ownerId=cloudUser?.id){return workspaceStorageKey()+'-sync-meta'+(ownerId?'-'+ownerId:'')}
function saveSyncMeta(){try{localStorage.setItem(syncMetaKey(),JSON.stringify({lastSyncedAt,pending:!!(cloudReady&&cloudUser&&cloudMode!=='synced'),updatedAt:Date.now()}))}catch(error){console.warn("Operation failed; diagnostic details redacted.")}}
function restoreSyncMeta(ownerId=cloudUser?.id){try{const meta=JSON.parse(localStorage.getItem(syncMetaKey(ownerId))||'{}');lastSyncedAt=meta.lastSyncedAt||null}catch{lastSyncedAt=null}}
function cloudStatus(message){
 const el=document.querySelector('#cloud-status');
 if(el){
  const label=cloudMode==='synced'?'Synced':cloudMode==='offline'?'Offline':cloudMode==='error'?'Sync issue':cloudMode==='syncing'?'Syncing…':cloudMode==='loading'?'Restoring…':'Saved locally';
  const time=lastSyncedAt?' · '+new Date(lastSyncedAt).toLocaleString():'';
  el.textContent=label+time+(cloudReady&&cloudUser&&cloudMode!=='synced'?' · Changes waiting to sync':'');
  el.title=cloudLastError||message||'Signed-in workspaces sync securely across devices. Guest data stays on this device.';
  el.dataset.state=cloudMode;
 }
}
function setCloudMode(mode,error=''){cloudMode=mode;cloudLastError=error;cloudStatus();saveSyncMeta()}
function writeLocalWorkspace(snapshot){
 const serialized=JSON.stringify(migrateData(snapshot));
 localStorage.setItem(workspaceStorageKey(),serialized);
 localStorage.setItem(workspaceStorageKey()+'-last-good',serialized);
 return saveWorkspaceSnapshot(JSON.parse(serialized));
}
function mergeWorkspaceSnapshots(localSnapshot,remoteSnapshot){
 const local=migrateData(localSnapshot),remote=migrateData(remoteSnapshot),merged={...remote};
 const keys=new Set([...Object.keys(local),...Object.keys(remote)]);
 for(const key of keys){
  if(Array.isArray(local[key])&&Array.isArray(remote[key])){
   const records=new Map();
   const stamp=item=>Math.max(Number(item?.updated)||0,Number(item?.created)||0,...['updated_at','updatedAt','modified_at','modifiedAt','created_at','createdAt'].map(k=>Date.parse(item?.[k]||'')||0));
   for(const item of remote[key])records.set(item?.id??JSON.stringify(item),item);
   for(const item of local[key]){
    const id=item?.id??JSON.stringify(item),existing=records.get(id);
    if(!existing||stamp(item)>stamp(existing))records.set(id,item);
   }
   merged[key]=Array.from(records.values());
  }else if(!(key in merged))merged[key]=local[key];
 }
 merged.schemaVersion=Math.max(Number(local.schemaVersion)||1,Number(remote.schemaVersion)||1);
 return migrateData(merged);
}
let workspaceChannel=null,cloudRefreshInFlight=null;
function stopWorkspaceRealtime(){
 if(workspaceChannel&&cloudClient)cloudClient.removeChannel(workspaceChannel).catch(()=>{});
 workspaceChannel=null;
}
function persist(){
 const snapshot=JSON.stringify(data);
 try{
  localStorage.setItem(workspaceStorageKey(),snapshot);
  localStorage.setItem(workspaceStorageKey()+'-last-good',snapshot);
  if(cloudReady&&cloudUser)setCloudMode(navigator.onLine?'syncing':'offline');
  else setCloudMode('offline','Guest data is saved on this device. Sign in to sync across devices.');
 }catch(err){
  console.warn("Operation failed; diagnostic details redacted.");
  setCloudMode('error',err.message);
  toast('Local save failed. Export a backup and free storage.');
 }
 saveWorkspaceSnapshot(data).catch(err=>{
  console.warn("Operation failed; diagnostic details redacted.");
  window.studentBrainStorageHealth={state:'warning',message:err.message||'IndexedDB copy failed'};
 });
 if(cloudReady&&cloudUser)queueCloudSave();
}
function queueCloudSave(){
 if(!cloudReady||!cloudUser||!cloudClient)return Promise.resolve();
 const ownerId=cloudUser.id,snapshot=JSON.parse(JSON.stringify(data));
 try{localStorage.setItem(workspaceStorageKey()+'-pending-cloud',JSON.stringify({ownerId,snapshot,queuedAt:Date.now()}))}catch(error){console.warn("Operation failed; diagnostic details redacted.")}
 setCloudMode(navigator.onLine?'syncing':'offline');
 syncQueue=syncQueue.catch(()=>{}).then(()=>saveCloudSnapshot(snapshot,ownerId));
 return syncQueue;
}
async function saveCloudSnapshot(snapshot,ownerId=cloudUser?.id){
 try{
  if(!navigator.onLine)throw Error('Device is offline; changes are saved locally and will sync when online.');
  if(!ownerId||ownerId!==cloudUser?.id||!cloudClient)return;
  const {error}=await cloudClient.from('user_workspaces').upsert({
   user_id:ownerId,workspace_data:migrateData(snapshot),schema_version:DATA_SCHEMA_VERSION,updated_at:new Date().toISOString()
  },{onConflict:'user_id'});
  if(error)throw error;
  if(ownerId!==cloudUser?.id)return;
  cloudRetryDelay=1500;lastSyncedAt=new Date().toISOString();
  try{localStorage.removeItem(workspaceStorageKey()+'-pending-cloud')}catch{}
  setCloudMode('synced');
 }catch(err){
  console.warn("Operation failed; diagnostic details redacted.");
  if(ownerId!==cloudUser?.id)return;
  setCloudMode(navigator.onLine?'error':'offline',err.message);
  if(cloudRetryTimer)clearTimeout(cloudRetryTimer);
  cloudRetryTimer=setTimeout(()=>{if(cloudReady&&cloudUser?.id===ownerId&&navigator.onLine)queueCloudSave()},cloudRetryDelay);
  cloudRetryDelay=Math.min(cloudRetryDelay*2,60000);
 }
}
async function refreshCloudWorkspace(ownerId=cloudUser?.id){
 if(!cloudReady||!cloudClient||!ownerId||ownerId!==cloudUser?.id||!navigator.onLine)return;
 if(cloudRefreshInFlight)return cloudRefreshInFlight;
 cloudRefreshInFlight=(async()=>{
  const {data:row,error}=await cloudClient.from('user_workspaces').select('workspace_data,updated_at,revision').eq('user_id',ownerId).maybeSingle();
  if(error)throw error;
  if(ownerId!==cloudUser?.id)return;
  if(!row){await saveCloudSnapshot(data,ownerId);return}
  const merged=mergeWorkspaceSnapshots(data,row.workspace_data||{});
  const mergedText=JSON.stringify(merged),remoteText=JSON.stringify(migrateData(row.workspace_data||{}));
  data=merged;
  await writeLocalWorkspace(data);
  render();
  if(mergedText!==remoteText)await saveCloudSnapshot(merged,ownerId);
  else{lastSyncedAt=row.updated_at||new Date().toISOString();setCloudMode('synced')}
 })().catch(error=>{
  console.warn("Operation failed; diagnostic details redacted.");
  if(ownerId===cloudUser?.id)setCloudMode('error',error.message||'Could not restore cloud data.');
 }).finally(()=>{cloudRefreshInFlight=null});
 return cloudRefreshInFlight;
}
function subscribeWorkspaceRealtime(ownerId){
 stopWorkspaceRealtime();
 if(!cloudClient||!ownerId)return;
 workspaceChannel=cloudClient.channel('one-workspace-'+ownerId)
  .on('postgres_changes',{event:'*',schema:'public',table:'user_workspaces',filter:'user_id=eq.'+ownerId},payload=>{
   if(ownerId!==cloudUser?.id||!cloudReady||!payload.new?.workspace_data)return;
   const remote=payload.new.workspace_data,merged=mergeWorkspaceSnapshots(data,remote);
   const remoteText=JSON.stringify(migrateData(remote));
   data=merged;
   writeLocalWorkspace(data).then(()=>render()).catch(error=>console.warn("Operation failed; diagnostic details redacted."));
   if(JSON.stringify(merged)!==remoteText)queueCloudSave();
   else{lastSyncedAt=payload.new.updated_at||new Date().toISOString();setCloudMode('synced')}
  }).subscribe(status=>{
   if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn("Operation failed; diagnostic details redacted.");
  });
}
async function activateCloudWorkspace(userId){
 restoreSyncMeta(userId);
 if(!cloudClient)throw new Error('Cloud sync client is unavailable.');
 const {data:sessionData,error:sessionError}=await cloudClient.auth.getSession();
 if(sessionError)throw sessionError;
 if(sessionData.session?.user?.id!==userId)throw new Error('Your sign-in session is not ready for cloud sync. Please sign in again.');
 cloudUser=sessionData.session.user;cloudReady=true;setCloudMode('loading');
 await refreshCloudWorkspace(userId);
 subscribeWorkspaceRealtime(userId);
}
function initCloud(){
 try{
  if(!window.supabase?.createClient)throw new Error('Supabase client did not load.');
  cloudClient=window.supabase.createClient(CLOUD_URL,CLOUD_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'one-auth-session-v1'}});
  setCloudMode('offline','Guest workspaces are device-only. Sign in to enable secure cloud sync.');
 }catch(error){console.warn("Operation failed; diagnostic details redacted.");setCloudMode('error',error.message)}
}
window.addEventListener('online',()=>{if(cloudReady&&cloudUser)refreshCloudWorkspace(cloudUser.id)});
window.addEventListener('focus',()=>{if(cloudReady&&cloudUser)refreshCloudWorkspace(cloudUser.id)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudReady&&cloudUser)refreshCloudWorkspace(cloudUser.id)});


async function readOneShareInbox(){
 return await new Promise((resolve,reject)=>{
  const request=indexedDB.open('one-share-inbox',1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('captures'))request.result.createObjectStore('captures',{keyPath:'id'})};
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('captures','readonly'),get=tx.objectStore('captures').getAll();get.onsuccess=()=>{resolve(get.result||[]);db.close()};get.onerror=()=>{reject(get.error);db.close()}};
 });
}
async function removeOneSharedCapture(id){
 return await new Promise(resolve=>{const request=indexedDB.open('one-share-inbox',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('captures','readwrite');tx.objectStore('captures').delete(id);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{db.close();resolve(false)}};request.onerror=()=>resolve(false)});
}
function quickCaptureVoice(){
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Speech){toast('Voice capture is not supported in this browser');return}
 const recognition=new Speech();recognition.lang='en-IN';recognition.interimResults=false;recognition.maxAlternatives=1;
 const button=document.querySelector('#quick-capture-voice');if(button){button.disabled=true;button.textContent='Listening…'}
 recognition.onresult=event=>{const transcript=String(event.results?.[0]?.[0]?.transcript||'').trim();if(!transcript){toast('I could not hear that clearly');return}page='ask';render();sendChat(transcript)};
 recognition.onerror=event=>toast(event.error==='not-allowed'?'Allow microphone access to capture by voice':'Voice capture failed. Try again.');
 recognition.onend=()=>{if(button?.isConnected){button.disabled=false;button.textContent='🎙 Voice'}};
 try{recognition.start()}catch(error){toast('Could not start voice capture');if(button){button.disabled=false;button.textContent='🎙 Voice'}}
}
async function handleOneSharedCapture(capture){
 const text=String(capture.text||'').trim(),url=String(capture.url||'').trim(),title=String(capture.title||'').trim(),files=Array.isArray(capture.files)?capture.files:[];
 if(files.length){
  for(const item of files){
   if(!item?.blob||item.size>12*1024*1024){toast('Shared file is empty or over 12 MB');continue}
   const file=new File([item.blob],item.name||'Shared file',{type:item.type||item.blob.type||'application/octet-stream'});
   const isImage=file.type.startsWith('image/')||/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
   let ocr='';
   if(isImage&&window.Tesseract){try{ocr=await runImageOCR(file)}catch(error){console.warn("Operation failed; diagnostic details redacted.")}}
   await processUploadedDocuments([file]);
   const savedDocument=[...(data.documents||[])].reverse().find(doc=>doc.name===file.name);
   const receiptText=ocr||savedDocument?.extractedText||'';
   const receipt=/(tax invoice|invoice|receipt|total amount|grand total|amount paid|gstin|cashier|subtotal)/i.test(receiptText)&&/\b(?:total|amount|paid|rs\.?|inr|₹)\b/i.test(receiptText);
   if(receipt){
    const amounts=[...receiptText.matchAll(/(?:grand\s+total|total\s+amount|amount\s+paid|total|₹|rs\.?|inr)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi)].map(x=>Number(x[1].replace(/,/g,''))).filter(x=>x>0&&x<10000000);
    const amount=amounts.length?amounts[amounts.length-1]:'';
    const vendor=receiptText.split(/\r?\n/).map(x=>x.trim()).find(x=>x.length>2&&x.length<65&&!/invoice|receipt|gstin|phone|date|total|cashier/i.test(x))||file.name.replace(/\.[^.]+$/,'');
    openForm('expense');const form=document.querySelector('#edit-form');
    if(form){form.elements.description.value=vendor;form.elements.amount.value=amount;form.elements.category.value='Other';}
    toast(amount?'Receipt saved to Document Vault. Check the expense details.':'Receipt saved to Document Vault. Enter its amount to finish.');
   }else toast(file.type==='application/pdf'?'PDF added to Document Vault':'Image added to Document Vault');
  }
 }
 if(text||url){
  const command=/\b(remind me|set (?:a )?reminder|reminder laga|yaad dila|add (?:a )?task|create (?:a )?task|task bana|task add)\b/i.test(text);
  if(command){page='ask';render();await sendChat(text);return}
  const content=[text,url?'Shared link: '+url:''].filter(Boolean).join('\n\n');
  data.notes.unshift({id:uid(),title:title||'Shared from another app',content,subject:'Quick capture',tags:'shared quick capture',created:Date.now(),updated:Date.now()});
  persist();toast('Shared text saved as a note');
 }
}
async function consumeOneShareInbox(){
 const params=new URLSearchParams(location.search);if(params.get('shared')!=='1')return;
 history.replaceState(history.state||{sbPage:page},'',location.pathname);
 try{
  const captures=await readOneShareInbox();
  for(const capture of captures){await handleOneSharedCapture(capture);await removeOneSharedCapture(capture.id)}
  if(!captures.length)toast('No shared item was found. Please share it again.');
 }catch(error){console.warn("Operation failed; diagnostic details redacted.");toast('Could not open the shared item. Try sharing again.')}
}
function formatChatText(value=''){
 let text=String(value??'').replace(/\\n/g,'\n').replace(/\/n/g,'\n').replace(/\r\n?/g,'\n');
 return text.split('\n').map(line=>{
  const safe=esc(line);
  const match=line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
  return match?'<div class="chat-list-item"><span class="chat-list-marker">'+esc((line.match(/^\s*(?:[-*•]|\d+[.)])/)||['•'])[0].trim())+'</span><span>'+esc(match[1])+'</span></div>':safe;
 }).join('<br>');
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function money(n){return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(n)||0)}
function dateFmt(d){if(!d)return 'No date';const x=new Date(d+'T00:00:00');return isNaN(x)?d:x.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function toast(msg){const t=document.querySelector('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove('show'),2300)}
function updateNotificationBell(){
 const badge=document.querySelector('#notification-unread-count');
 if(!badge)return;
 const count=(data.notifications||[]).filter(item=>!item.read).length;
 badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;
}
function addAppNotification({title,body,type='reminder',taskId=null,tag=null,relatedType=null,relatedId=null}){
 data.notifications=Array.isArray(data.notifications)?data.notifications:[];
 const key=tag||type+'-'+(taskId||'')+'-'+Math.floor(Date.now()/60000);
 if(data.notifications.some(item=>item.tag===key))return null;
 const item={id:uid(),title:String(title||'One reminder'),body:String(body||''),type,taskId,relatedType,relatedId,tag:key,read:false,createdAt:Date.now()};
 data.notifications.unshift(item);data.notifications=data.notifications.slice(0,100);
 persist();updateNotificationBell();return item;
}
function snoozeTaskReminder(taskId,minutes){
 const task=(data.tasks||[]).find(t=>t.id===taskId);if(!task||task.done){toast('This reminder is no longer active');return}
 task.snoozedUntil=new Date(Date.now()+minutes*60000).toISOString();task.updated=Date.now();
 (data.notifications||[]).filter(n=>n.taskId===taskId&&!n.read).forEach(n=>{n.read=true;n.snoozedUntil=task.snoozedUntil});
 persist();notificationCentre();toast('Reminder snoozed for '+(minutes===1440?'1 day':minutes===60?'1 hour':'10 minutes'));
}
function reminderOccurrenceOn(task,date){
 if(!task?.due||date<task.due)return false;
 const rule=task.repeatRule||'none';if(rule==='none')return date===task.due;
 const [y,m,d]=task.due.split('-').map(Number),[cy,cm,cd]=date.split('-').map(Number);
 const start=Date.UTC(y,m-1,d),current=Date.UTC(cy,cm-1,cd),days=Math.round((current-start)/86400000);
 if(rule==='daily')return days>=0;
 if(rule==='weekly')return days>=0&&days%7===0;
 if(rule==='monthly'){const lastDay=new Date(Date.UTC(cy,cm,0)).getUTCDate();return cd===Math.min(d,lastDay)}
 return date===task.due;
}
function notificationCentre(){
 const items=Array.isArray(data.notifications)?data.notifications:[];
 const unread=items.filter(item=>!item.read).length;
 const body='<div class="notification-centre-head"><span>'+items.length+' notifications</span><button type="button" class="btn small" data-action="mark-all-notifications-read" '+(unread?'':'disabled')+'>Mark all read</button></div>'+
 (items.length?'<div class="notification-list">'+items.map(item=>'<article class="notification-item '+(item.read?'is-read':'is-unread')+'"><span class="notification-item-icon">'+(item.type==='task'?'✓':'🔔')+'</span><div class="notification-item-copy"><b>'+esc(item.title)+'</b><p>'+esc(item.body)+'</p><small>'+esc(new Date(item.createdAt||Date.now()).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}))+'</small>'+(item.taskId?'<div class="notification-actions"><button type="button" class="btn small" data-action="snooze-task-10" data-id="'+esc(item.taskId)+'">Snooze 10m</button><button type="button" class="btn small" data-action="snooze-task-60" data-id="'+esc(item.taskId)+'">1h</button><button type="button" class="btn small" data-action="snooze-task-1440" data-id="'+esc(item.taskId)+'">1d</button><button type="button" class="btn small" data-action="reschedule-notification-task" data-id="'+esc(item.taskId)+'">Reschedule</button><button type="button" class="btn small" data-action="complete-notification-task" data-id="'+esc(item.taskId)+'">Complete</button></div>':'')+(item.relatedType==='note'?'<button type="button" class="btn small" data-action="open-notification-note" data-id="'+esc(item.id)+'">Open note</button>':'')+(item.relatedType==='document'?'<button type="button" class="btn small" data-action="open-notification-document" data-id="'+esc(item.id)+'">Open document</button>':'')+'</div><button type="button" class="notification-read-action" data-action="mark-notification-read" data-id="'+esc(item.id)+'" aria-label="Mark as read">'+(item.read?'✓':'•')+'</button></article>').join('')+'</div>':'<div class="notification-empty"><span>♧</span><b>You are all caught up</b><p>Task reminders and important updates will appear here.</p></div>');
 modal('Notifications',body,'Close');
 const save=document.querySelector('#edit-form .modal-save-button');if(save){save.type='button';save.dataset.action='close-modal';}
}

function empty(msg,icon='✧'){return `<div class="empty"><div class="empty-symbol">${icon}</div>${esc(msg)}</div>`}
function backHomeButton(){return '<button type="button" class="back-home-icon" data-page="overview" aria-label="Back to Home" title="Back to Home">←</button>'}
function titleBlock(kicker,title,sub,button=''){return `<div class="row" style="align-items:flex-start"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${button}</div>`}
function btn(label,action,primary=false,small=false){return `<button class="btn ${primary?'primary':''} ${small?'small':''}" data-action="${action}">${label}</button>`}
function stat(label,num,note,icon,target){return `<div class="card stat-card" ${target?`data-page="${target}" role="button" tabindex="0" title="Open ${esc(label)}"`:''}><div class="row"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${num}</div><div class="stat-note">${note}${target?'<span class="stat-open-hint"> · View details →</span>':''}</div></div>`}
function taskRow(t){const completedLabel=t.done?(t.completedAt?`Completed · ${new Date(t.completedAt).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})}`:'Completed · time not recorded') : '';const overdue=!t.done&&t.due&&t.due<today(),dueLabel=t.due?(overdue?'Overdue · ':'Due · ')+dateFmt(t.due):'No due date';return `<div class="list-item planner-task ${overdue?'is-overdue':''} ${t.done?'is-complete':''}"><button type='button' class='planner-check-circle ${t.done?"checked":""}' data-action='toggle-task' data-id='${t.id}' aria-label='${t.done?"Mark incomplete":"Mark complete"}' title='${t.done?"Mark incomplete":"Mark complete"}'>${t.done?"✓":""}</button><button type="button" class="planner-task-open" data-action="edit-task" data-id="${t.id}" aria-label="Open task details for ${esc(t.title)}"><span class="list-copy"><b class="${t.done?'task-done':''}">${esc(t.title)}</b><small class="task-meta"><span class="task-category">${esc(t.category||'General')}</span><span class="task-meta-separator"> · </span><span class="task-due">${dueLabel}</span>${t.done?`<span class="task-completed-at"> · ${esc(completedLabel)}</span>`:''}</small>${t.notes&&String(t.notes).trim()?`<span class="task-notes">${esc(String(t.notes).trim())}</span>`:'<span class="task-notes task-notes-empty">No notes added</span>'}</span></button><button class="task-complete-action ${t.done?'checked':''}" type="button" data-action="toggle-task" data-id="${t.id}" title="${t.done?'Mark incomplete':'Mark complete'}" aria-label="${t.done?'Mark incomplete':'Mark complete'}">${t.done?'✓':'Complete'}</button></div>`;}function noteRow(n){return `<div class="list-item"><div class="list-icon">▤</div><div class="list-copy"><b>${esc(n.title)}</b><small>${esc(n.subject||'General')} · ${new Date(n.updated).toLocaleDateString('en-IN')}</small></div><button class="btn small" data-action="edit-note" data-id="${n.id}">Open</button></div>`}
function projectRelatedItems(project){
 const terms=aiQueryTerms([project.name,project.description,project.status].join(' ')).slice(0,30),rows=[];
 const add=(item,type,title,body,detail='')=>{const explicit=item.projectId===project.id||item.relatedProjectId===project.id||(Array.isArray(item.projectIds)&&item.projectIds.includes(project.id));const score=aiTextScore([title,body].join(' '),terms);if(explicit||score>=2)rows.push({id:item.id,type,title,detail,score:score+(explicit?100:0),explicit})};
 (data.notes||[]).forEach(x=>add(x,'Note',x.title||'Untitled note',[x.subject,x.tags,x.content].join(' '),x.subject||'Saved note'));
 (data.documents||[]).forEach(x=>add(x,'Document',x.name||'Uploaded document',[x.extractedText,x.summary,JSON.stringify(x.extractedJson||{})].join(' '),x.type||'Uploaded file'));
 (data.tasks||[]).forEach(x=>add(x,'Task',x.title||'Untitled task',[x.category,x.notes].join(' '),x.done?'Completed':x.due?'Due '+dateFmt(x.due):'Task'));
 return rows.sort((a,b)=>b.score-a.score).slice(0,8);
}
function relatedItemsMarkup(items){
 if(!items.length)return '<p class="muted" style="font-size:12px">No related notes, files or tasks found yet. Add project details to improve suggestions.</p>';
 return '<div class="related-items-list">'+items.map(item=>'<button type="button" class="list-item related-item" data-action="open-vault-result" data-id="'+esc(item.id)+'"><span><b>'+esc(item.title)+'</b><small class="muted">'+esc(item.type)+' · '+esc(item.detail)+(item.explicit?' · Linked':' · Suggested')+'</small></span><span>↗</span></button>').join('')+'</div>';
}
function projectCard(p){
 const tasks=data.tasks.filter(t=>t.projectId===p.id),done=tasks.filter(t=>t.done).length,related=projectRelatedItems(p);
 return '<div class="card"><div class="row"><span class="stat-icon">▣</span><span class="tag '+(p.status==='Completed'?'green':'blue')+'">'+esc(p.status||'In progress')+'</span></div><h3 style="margin-top:17px">'+esc(p.name)+'</h3><p class="muted" style="font-size:12px;line-height:1.6;min-height:38px">'+esc(p.description||'No description yet.')+'</p><div class="row"><small class="muted">'+tasks.length+' tasks · '+dateFmt(p.targetDate)+'</small><button class="btn small" data-action="edit-project" data-id="'+p.id+'">Edit</button></div>'+(tasks.length?'<div class="progress"><span style="width:'+Math.round(done/tasks.length*100)+'%"></span></div>':'')+'<details class="project-related"><summary>Related items · '+related.length+'</summary>'+relatedItemsMarkup(related)+'</details></div>';
}
function scrollChatToBottom(){const chat=document.querySelector('#chat-messages');if(!chat)return;const scroll=()=>{chat.scrollTop=chat.scrollHeight;const last=chat.lastElementChild;if(last)last.scrollIntoView({block:'end',behavior:'auto'});};scroll();requestAnimationFrame(()=>requestAnimationFrame(scroll));}
function render(){try{document.body.classList.toggle('home-page',page==='overview');document.body.classList.toggle('has-page-back',page!=='overview'&&page!=='ask');let c=document.querySelector('#page-content');if(!c)throw Error('Main page container is missing');const pages={overview,ask,knowledge,vault:documentVault,uploads:uploadedItems,notes:notesOnly,planner,tasks,study:studyPlanner,backup:backupRestore,projects,expenses,loans:()=>{window.moneyTab='udhaar';return expenses()},settings,memory:personalMemory,analytics:()=>window.OneAnalytics?.dashboardHTML()||'<section class="card">Analytics is loading…</section>'};c.innerHTML=(pages[page]||overview)();updateNotificationBell();if(window.OneAnalytics)window.OneAnalytics.trackPage(page);if(page!=='overview'&&page!=='ask')c.insertAdjacentHTML('afterbegin',backHomeButton());if(page==='ask')scrollChatToBottom();document.querySelector('.mobile-nav')?.remove();document.querySelector('.floating-create-button')?.remove();if(page==='overview'){const fab=document.createElement('button');fab.className='floating-create-button';fab.type='button';fab.dataset.action='open-quick-add';fab.setAttribute('aria-label','Create new item');fab.innerHTML='<span aria-hidden="true">＋</span> Create';document.body.appendChild(fab)}}catch(err){console.warn("Operation failed; diagnostic details redacted.");const c=document.querySelector('#page-content');if(c)c.innerHTML='<section class="card"><h2>Workspace could not load</h2><p>Refresh the page. If this continues, export your backup before clearing browser data, then share the browser console error.</p><small></small></section>';const msg=document.querySelector('#page-content small');if(msg)msg.textContent=String(err?.message||err)}}
function closeQuickAddMenu(){
 const root=document.querySelector('#modal-root');
 root?.querySelector('.create-radial-backdrop')?.remove();
 root?.querySelector('.create-radial-menu')?.remove();
 const fab=document.querySelector('.floating-create-button');
 if(fab){fab.classList.remove('is-open');fab.setAttribute('aria-expanded','false');fab.setAttribute('aria-label','Create new item');fab.innerHTML='<span aria-hidden="true">＋</span> Create'}
}
function openQuickAdd(){
 const root=document.querySelector('#modal-root');
 const fab=document.querySelector('.floating-create-button');
 if(!root||!fab)return;
 if(root.querySelector('.create-radial-menu')){closeQuickAddMenu();return}
 const rect=fab.getBoundingClientRect();
 const radiusX=Math.min(138,Math.max(104,(window.innerWidth-88)/2));
 const radiusY=112;
 const centerX=window.innerWidth>760?Math.min(rect.left+rect.width/2,window.innerWidth-radiusX-40):rect.left+rect.width/2;
 const options=[
  {action:'new-knowledge-entry',icon:'✧',label:'Note',hint:'Knowledge Entry'},
  {action:'new-task',icon:'☑',label:'Task',hint:'Add a task'},
  {action:'new-study',icon:'📚',label:'Study',hint:'Study session'},
  {action:'new-expense',icon:'₹',label:'Money',hint:'Money record'},
  {action:'new-project',icon:'▣',label:'Project',hint:'Create project'},
  {action:'quick-add-upload',icon:'↥',label:'Upload',hint:'Upload PDF or image'}
 ];
 const angles=[160,132,104,76,48,20];
 const menu=document.createElement('div');
 menu.className='create-radial-menu';
 menu.setAttribute('role','menu');
 menu.setAttribute('aria-label','Create something');
 menu.style.left=centerX+'px';
 menu.style.top=rect.top+'px';
 menu.innerHTML=options.map((o,i)=>{
  const radians=angles[i]*Math.PI/180;
  const x=Math.round(Math.cos(radians)*radiusX);
  const y=Math.round(Math.sin(radians)*radiusY);
  return `<button type="button" class="create-radial-option" role="menuitem" data-action="${o.action}" aria-label="${o.hint}" title="${o.hint}" style="--arc-x:${x}px;--arc-y:${y}px;--arc-delay:${i*55}ms"><span class="create-radial-icon" aria-hidden="true">${o.icon}</span><span class="create-radial-label">${o.label}</span></button>`;
 }).join('');
 const backdrop=document.createElement('div');
 backdrop.className='create-radial-backdrop';
 backdrop.setAttribute('aria-hidden','true');
 root.querySelector('.create-radial-backdrop')?.remove();
 root.appendChild(backdrop);
 root.appendChild(menu);
 if(!root.querySelector('#quick-add-file-upload')){
  const storage=document.createElement('div');
  storage.className='create-quick-upload-storage';
  storage.innerHTML='<input id="quick-add-file-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,application/pdf,image/*" multiple hidden><div id="quick-add-upload-status" role="status" aria-live="polite">Choose a PDF or image (up to 12 MB each).</div>';
  root.appendChild(storage);
 }
 fab.classList.add('is-open');
 fab.setAttribute('aria-expanded','true');
 fab.setAttribute('aria-label','Close create menu');
 fab.innerHTML='<span aria-hidden="true">×</span> Close';
}function smartWeekSummary(){
 const end=today(),startDate=new Date(end+'T00:00:00');startDate.setDate(startDate.getDate()-6);
 const start=startDate.getFullYear()+'-'+String(startDate.getMonth()+1).padStart(2,'0')+'-'+String(startDate.getDate()).padStart(2,'0');
 const inRange=date=>!!date&&date>=start&&date<=end;
 const expenses=(data.expenses||[]).filter(e=>inRange(e.date));
 const sum=kind=>expenses.filter(e=>(e.kind||'expense')===kind).reduce((total,e)=>total+Number(e.amount||0),0);
 const completed=(data.tasks||[]).filter(t=>t.done&&Number(t.completedAt||0)>=startDate.getTime()).length;
 const overdue=(data.tasks||[]).filter(t=>!t.done&&t.due&&t.due<end).length;
 const dueSoon=(data.tasks||[]).filter(t=>!t.done&&t.due&&t.due>=end&&t.due<=addDaysToDate(end,7)).length;
 return {start,end,spent:sum('expense'),income:sum('income'),completed,overdue,dueSoon};
}
function addDaysToDate(date,days){
 const d=new Date(date+'T00:00:00');d.setDate(d.getDate()+days);
 return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function smartProjectProgress(){
 return (data.projects||[]).filter(p=>(p.status||'In progress')!=='Completed').map(project=>{
  const tasks=(data.tasks||[]).filter(t=>t.projectId===project.id),done=tasks.filter(t=>t.done).length;
  return {project,total:tasks.length,done,percent:tasks.length?Math.round(done/tasks.length*100):0};
 }).sort((a,b)=>(a.project.targetDate||'9999').localeCompare(b.project.targetDate||'9999')).slice(0,3);
}
function upcomingUdhaar(){
 const rows=(data.expenses||[]).filter(e=>['lent','borrowed'].includes(e.kind)&&e.dueDate&&e.dueDate<=addDaysToDate(today(),7));
 return rows.filter(entry=>{
  const same=(data.expenses||[]).filter(e=>e.person===entry.person&&((entry.kind==='lent'&&['lent','lent_repayment'].includes(e.kind))||(entry.kind==='borrowed'&&['borrowed','borrowed_repayment'].includes(e.kind))));
  const original=same.filter(e=>e.kind===entry.kind).reduce((n,e)=>n+Number(e.amount||0),0);
  const repaid=same.filter(e=>e.kind===(entry.kind==='lent'?'lent_repayment':'borrowed_repayment')).reduce((n,e)=>n+Number(e.amount||0),0);
  return original-repaid>0;
 }).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,4);
}
function oneWelcomeGreeting(){
 const account=activeWorkspaceUserId||'guest';
 const key='one-last-visit-'+account,sessionKey='one-session-welcomed-'+account;
 let lastVisit='';try{lastVisit=localStorage.getItem(key)||''}catch(_){}
 let first=!lastVisit;
 try{if(sessionStorage.getItem(sessionKey))first=false;else sessionStorage.setItem(sessionKey,'1')}catch(_){}
 try{localStorage.setItem(key,new Date().toISOString())}catch(_){}
 const name=cloudUser?.user_metadata?.full_name||cloudUser?.user_metadata?.name||cloudUser?.email?.split('@')[0]||'';
 return {heading:first?'Welcome to One':'Good to see you again',name};
}
function overview(){
  const greeting=oneWelcomeGreeting();
  const open=data.tasks.filter(t=>!t.done),due=open.filter(t=>t.due&&t.due>today()).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,3),month=today().slice(0,7),spend=data.expenses.filter(e=>(e.kind||'expense')==='expense'&&e.date?.startsWith(month)).reduce((s,e)=>s+Number(e.amount||0),0);
  const week=smartWeekSummary(),overdueTasks=open.filter(t=>t.due&&t.due<today()).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,3);
 return `<div class="home-dashboard">
  <div class="home-greeting"><div class="eyebrow">YOUR PERSONAL WORKSPACE</div><h1>${greeting.heading}${greeting.name?', '+esc(greeting.name):''}</h1><p class="subtitle">Your life, work, and goals—organized in one place.</p></div>
  <section class="home-hero">
   <div class="home-hero-meta"><span class="eyebrow">✦ ASK ONE</span><span class="home-hero-powered">Your personal AI assistant</span></div>
   <h2>What can I help you with?</h2>
   <form class="home-brain-search" id="home-brain-search"><span class="home-search-symbol" aria-hidden="true">⌕</span><input id="home-brain-query" aria-label="Ask One" placeholder="Ask One anything…" autocomplete="off"><button class="home-mic-button" type="button" data-action="voice-quick-command" aria-label="Start voice assistant" title="Speak to One"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"></path></svg></button><button class="home-chat-open" type="button" data-page="ask" aria-label="Open chat history" title="Open chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3.4A7.5 7.5 0 1 1 20 11.5Z"></path><path d="M8 11h8M8 14h5"></path></svg></button></form>
   <div class="home-prompts"><span>Try:</span><button type="button" data-question="Summarize today's priorities">Summarize today's priority</button><button type="button" data-question="Track an expense">Track expense</button><button type="button" data-question="Draft a note">Draft note</button></div>
  </section>
  <div class="grid stats home-stats">${stat('Open tasks',open.length,'Tasks & deadlines','◷','planner')}${stat('Uploaded items',(data.documents||[]).length,'PDFs & images','↥','uploads')}${stat('Notes',data.notes.length,'Written notes','▤','notes')}${stat('Money',money(spend),'Spent this month','₹','expenses')}</div>
  <section class="card quick-note-widget"><div class="row"><div><div class="eyebrow">QUICK CAPTURE</div><h2>Save a note instantly</h2><p class="muted">A thought, reminder or idea — saved to your One notes.</p></div><span class="quick-note-icon">✎</span></div><form id="home-quick-note-form"><input name="title" aria-label="Note title" placeholder="Title (optional)"><textarea name="content" aria-label="Quick note" placeholder="Write something to remember…" required rows="3"></textarea><div class="row"><small class="muted">♙ Private to your One workspace</small><button class="btn primary" type="submit">Save note ↗</button><button class="btn" type="button" id="quick-capture-voice">🎙 Voice</button></div></form></section>
  <section class="card smart-briefing"><div class="row"><div><div class="eyebrow">ONE INTELLIGENCE</div><h2>Task briefing</h2><p class="muted">Tell Ask One what to remind you about, and when.</p></div><span class="tag blue">${(data.tasks||[]).filter(t=>!t.done&&t.category==='Briefing').length} scheduled</span></div><div class="smart-briefing-list">${(data.tasks||[]).filter(t=>!t.done&&t.category==='Briefing').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,4).map(t=>'<div class="smart-briefing-item"><span class="tag blue">'+((t.repeatRule||'none')==='daily'?'Daily':dateFmt(t.due))+'</span><b>'+esc(t.title)+'</b><small>'+(t.reminderTime||'09:00')+'</small></div>').join('')||'<p class="muted">No briefings scheduled. Try: “Roz subah 9 baje mujhe project updates batana” or “20 November ko Suresh ko call karna yaad dilana”.</p>'}</div><div class="row smart-briefing-actions"><button class="btn small" type="button" data-action="go-ask">Set with Ask One ↗</button><button class="btn small" type="button" data-action="enable-reminders">Enable notifications</button></div></section>
  <section class="card home-coming-up"><div class="home-section-heading"><h2>Coming up</h2>${btn('View all →','go-planner',false,true)}</div><div class="list">${due.length?due.map(taskRow).join(''):empty('No upcoming tasks yet. Add a task with a due date.','▦')}</div></section>
  <section class="grid smart-insights-grid">
   <article class="card smart-insight-card"><div class="eyebrow">LAST 7 DAYS</div><h2>Weekly review</h2><div class="smart-metric-grid"><div><small>Spent</small><b>${money(week.spent)}</b></div><div><small>Income</small><b>${money(week.income)}</b></div><div><small>Tasks done</small><b>${week.completed}</b></div><div><small>Overdue</small><b>${week.overdue}</b></div></div><p class="muted">From ${dateFmt(week.start)} to ${dateFmt(week.end)} · Net ${money(week.income-week.spent)}</p><button class="btn small" type="button" data-action="go-money-reports">Open money reports</button></article>
  </section>

 </div>`;
}
async function summarizeDocument(id){
 const doc=(data.documents||[]).find(x=>x.id===id);if(!doc)return;
 if(!String(doc.extractedText||'').trim()||/^\[No readable text/.test(doc.extractedText)){toast('No extracted text available. Run OCR first.');return}
 const button=document.querySelector('[data-action="summarize-document"][data-id="'+CSS.escape(id)+'"]');
 if(button){button.disabled=true;button.textContent='Summarizing…'}
 try{
  const prompt='Create a concise, accurate summary of this uploaded document. Include its purpose, key facts, important dates, deadlines or expiry details, and action items. Use only information in the document. Clearly say when something is not stated. Do not guess. Keep it under 250 words.';
  const result=await requestStudentBrainAI(prompt,id);
  doc.summary=result.answer.trim().slice(0,5000);doc.summaryUpdatedAt=Date.now();doc.summarySources=result.sources||[];persist();render();toast('AI summary saved to your document');
 }catch(error){console.warn("Operation failed; diagnostic details redacted.");toast(error.message||'Could not summarize document')}
 finally{if(button&&button.isConnected){button.disabled=false;button.textContent='Generate AI summary'}}
}
function openVaultResult(id){
 const doc=(data.documents||[]).find(x=>x.id===id);
 if(doc){page='vault';window.vaultDocumentQuery='';render();requestAnimationFrame(()=>document.getElementById('vault-document-'+CSS.escape(id))?.scrollIntoView({behavior:'smooth',block:'center'}));return}
 const note=(data.notes||[]).find(x=>x.id===id);
 if(note){page='notes';window.noteQuery=note.title||'';render();return}
 const task=(data.tasks||[]).find(x=>x.id===id);
 if(task){page='planner';render();requestAnimationFrame(()=>openForm('task',id));return}
 const project=(data.projects||[]).find(x=>x.id===id);
 if(project){page='projects';render();return}
 const memory=(data.memories||[]).find(x=>x.id===id);
 if(memory){page='memory';render();return}
 const expense=(data.expenses||[]).find(x=>x.id===id);
 if(expense){page='expenses';render();return}
 toast('This record is no longer available');
}
function documentRelatedNotes(doc){
 const linked=new Set(Array.isArray(doc.relatedNoteIds)?doc.relatedNoteIds:[]),terms=aiQueryTerms([doc.name,doc.extractedText,doc.summary].join(' ')).slice(0,24);
 return (data.notes||[]).map(note=>({note,score:aiTextScore([note.title,note.subject,note.tags,note.content].join(' '),terms),linked:linked.has(note.id)})).filter(x=>x.linked||x.score>0).sort((a,b)=>Number(b.linked)-Number(a.linked)||b.score-a.score).slice(0,4);
}
function documentsCards(){
 const docs=(data.documents||[]).filter(d=>{const q=String(window.vaultDocumentQuery||'').trim().toLowerCase();return !q||[d.name,d.originalName,(d.tags||[]).join(' '),d.note,d.extractedText,d.summary,JSON.stringify(d.extractedJson||{})].join(' ').toLowerCase().includes(q)}).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||(b.created||0)-(a.created||0));
 return '<div class="grid item-grid document-grid">'+(docs.length?docs.map(d=>{
  const related=documentRelatedNotes(d),noteOptions=(data.notes||[]).map(n=>'<option value="'+esc(n.id)+'" '+(Array.isArray(d.relatedNoteIds)&&d.relatedNoteIds.includes(n.id)?'selected':'')+'>'+esc(n.title||'Untitled note')+'</option>').join('');
  return '<article class="card document-card '+(d.pinned?'document-pinned':'')+'" id="vault-document-'+esc(d.id)+'">'+
   '<div class="row document-card-top"><span class="tag blue">'+(d.type==='pdf'?'PDF':'Image')+'</span><span class="muted">'+(d.pinned?'★ Pinned':'')+'</span><div class="spacer"></div><button class="btn small '+(d.pinned?'primary':'')+'" data-action="toggle-document-pin" data-id="'+esc(d.id)+'">'+(d.pinned?'Unpin':'Pin')+'</button><button class="btn small" data-action="ask-document" data-id="'+esc(d.id)+'">Ask AI</button><button class="btn small danger" data-action="delete-document" data-id="'+esc(d.id)+'">Delete</button></div>'+
   '<h3>'+esc(d.name)+'</h3><p class="muted">'+esc(d.originalName||'')+' · '+(d.size?Math.ceil(d.size/1024)+' KB':'')+' · '+(d.createdAt||d.created?new Date(d.createdAt||d.created).toLocaleDateString('en-IN'):'Date unavailable')+'</p>'+(d.tags?.length?'<p class="muted">'+d.tags.map(tag=>'#'+esc(tag)).join(' ')+'</p>':'')+(d.note?'<p>'+esc(d.note)+'</p>':'')+'<div class="actions"><button class="btn small" data-action="open-uploaded-file" data-id="'+esc(d.id)+'">View</button><button class="btn small" data-action="download-uploaded-file" data-id="'+esc(d.id)+'">Download</button><button class="btn small" data-action="rename-uploaded-file" data-id="'+esc(d.id)+'">Rename</button></div>'+
   '<div class="document-vault-expiry"><label for="document-expiry-'+esc(d.id)+'">Expiry / renewal date</label><div class="row"><input type="date" id="document-expiry-'+esc(d.id)+'" value="'+esc(d.expiresOn||'')+'" aria-label="Expiry date for '+esc(d.name)+'"><button class="btn small" data-action="save-document-expiry" data-id="'+esc(d.id)+'">Save date</button></div><small class="muted">'+(d.expiresOn?'Reminder enabled · '+dateFmt(d.expiresOn):'Add a date to receive expiry reminders')+'</small></div>'+
   '<div class="actions"><button class="btn small" data-action="extract-document-actions" data-id="'+esc(d.id)+'">Find action items & dates</button><button class="btn small primary" data-action="summarize-document" data-id="'+esc(d.id)+'">'+(d.summary?'Refresh AI summary':'Generate AI summary')+'</button><button class="btn small" data-action="convert-document-json" data-id="'+esc(d.id)+'">Extract structured data</button><button class="btn small" data-action="retry-document-ocr" data-id="'+esc(d.id)+'">Re-upload / OCR</button></div>'+
   (d.summary?'<section class="document-summary"><b>AI summary</b><p>'+esc(d.summary)+'</p><small class="muted">'+(d.summaryUpdatedAt?'Updated '+new Date(d.summaryUpdatedAt).toLocaleString('en-IN'):'')+'</small></section>':'')+
   '<section class="document-related"><b>Related notes</b>'+(related.length?'<ul>'+related.map(x=>'<li>'+esc(x.note.title||'Untitled note')+(x.linked?' · Connected':' · Suggested')+'</li>').join('')+'</ul>':'<p class="muted">No related notes found yet.</p>')+(data.notes.length?'<div class="row"><select data-document-note-select="'+esc(d.id)+'" aria-label="Choose a note to connect"><option value="">Connect a note…</option>'+noteOptions+'</select><button class="btn small" data-action="connect-document-note" data-id="'+esc(d.id)+'">Connect</button></div>':'')+'</section>'+
   '<small class="muted">'+esc(d.jsonStatus==='saved_to_knowledge'?'Structured data ready':d.jsonStatus==='processing'?'Extracting structured data…':d.jsonStatus==='error'?'Extraction issue: '+(d.jsonError||'Try again'):d.jsonStatus||'Text extracted')+'</small>'+(d.extractedJson?'<details><summary>Structured data · '+esc(d.extractedJson.document_type||'document')+'</summary><pre class="json-preview">'+esc(JSON.stringify(d.extractedJson,null,2).slice(0,12000))+'</pre></details>':'')+'<details><summary>Read extracted text</summary><p class="document-extract">'+esc((d.extractedText||'').slice(0,12000))+((d.extractedText||'').length>12000?'…':'')+'</p></details></article>';
 }).join(''):'<div class="card" style="grid-column:1/-1">'+empty(window.vaultDocumentQuery?'No uploaded documents match this search.':'No documents yet. Upload a PDF or image to start your vault.','📄')+'</div>')+'</div>';
}
function oneExtractDate(line){
 const s=String(line||'');let m=s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
 if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
 m=s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
 if(m){let y=Number(m[3]);if(y<100)y+=2000;const d=new Date(y,Number(m[2])-1,Number(m[1]));if(d.getFullYear()===y&&d.getMonth()===Number(m[2])-1&&d.getDate()===Number(m[1]))return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0')}
 m=s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+(20\d{2}))?/i);
 if(m){const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];const mo=months.findIndex(x=>m[2].toLowerCase().startsWith(x));const y=Number(m[3]||today().slice(0,4));const d=new Date(y,mo,Number(m[1]));if(d.getMonth()===mo&&d.getDate()===Number(m[1]))return y+'-'+String(mo+1).padStart(2,'0')+'-'+m[1].padStart(2,'0')}
 if(/\btomorrow\b|कल/i.test(s)){const d=new Date(today()+'T00:00:00');d.setDate(d.getDate()+1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
 if(/\btoday\b|आज/i.test(s))return today();return '';
}
function oneExtractActionCandidates(text,sourceLabel){
 const lines=String(text||'').replace(/\r/g,'').split(/\n|(?<=[.!?])\s+(?=[A-Z])/).map(x=>x.replace(/^\s*(?:[-•*]|\d+[.)])\s*/,'').trim()).filter(x=>x.length>=8&&x.length<=280);
 const cue=/\b(submit|complete|finish|prepare|study|revise|review|pay|renew|register|apply|upload|send|email|call|meet|attend|book|collect|visit|deadline|due|assignment|project|exam|presentation|report|remind|schedule|follow.?up|pending|must|need to|have to|should)\b|करना है|जमा|भेजना|याद दिलाना|पूरा करना/i;
 const seen=new Set(),out=[];for(const line of lines){if(!cue.test(line))continue;const title=line.replace(/\s+/g,' ').trim();const key=title.toLowerCase();if(seen.has(key))continue;seen.add(key);out.push({title:title.slice(0,140),due:oneExtractDate(line),source:sourceLabel});if(out.length>=15)break}return out;
}
function reviewOneExtractedActions(kind,id){
 const source=kind==='document'?(data.documents||[]).find(x=>x.id===id):(data.notes||[]).find(x=>x.id===id);if(!source)return;
 const label=source.name||source.title||'Source item';const raw=kind==='document'?source.extractedText:source.content;const suggestions=oneExtractActionCandidates(raw,label);
 if(!suggestions.length){toast('No clear action items found. Try a document with readable text or OCR.');return}
 window.oneActionReview={kind,id,suggestions};
 const rows=suggestions.map((x,i)=>'<label class="field full" style="display:flex;align-items:flex-start;gap:10px"><input type="checkbox" name="oneActionPick" value="'+i+'" checked style="width:auto;margin-top:4px"><span><b>'+esc(x.title)+'</b><small class="muted" style="display:block">'+(x.due?'Suggested due date · '+dateFmt(x.due):'No clear date detected')+'</small></span></label>').join('');
 modal('Review suggested action items','<p class="muted">Found '+suggestions.length+' possible action item(s) in '+esc(label)+'. Select what you want to add. Nothing is saved until you confirm.</p>'+rows,'Create selected tasks');
}
function saveOneExtractedActions(form){
 const review=window.oneActionReview;if(!review)return;const picks=[...form.querySelectorAll('[name="oneActionPick"]:checked')].map(x=>Number(x.value));if(!picks.length){toast('Select at least one suggestion');return}
 let added=0,duplicates=0;for(const i of picks){const item=review.suggestions[i];if(!item)continue;const duplicate=(data.tasks||[]).some(t=>!t.done&&String(t.title||'').trim().toLowerCase()===item.title.trim().toLowerCase()&&String(t.due||'')===String(item.due||''));if(duplicate){duplicates++;continue}
 data.tasks.push({id:uid(),title:item.title,category:'Other',due:item.due||'',reminderTime:'09:00',repeatRule:'none',notifyBeforeMinutes:0,priority:'Medium',relatedDocumentId:review.kind==='document'?review.id:'',relatedNoteId:review.kind==='note'?review.id:'',notes:'Extracted from '+(review.kind==='document'?'document':'note')+': '+(item.source||''),sourceReference:{type:review.kind,id:review.id},done:false,created:Date.now(),updated:Date.now()});added++;}
 if(added)persist();window.oneActionReview=null;document.querySelector('#modal-root').innerHTML='';page='planner';render();toast(added+' task(s) created'+(duplicates?' · '+duplicates+' duplicate(s) skipped':''));
}
function phase5SearchResults(query){
 const terms=aiQueryTerms(query);if(!terms.length)return [];const results=[],add=(id,title,type,body,detail='')=>{const score=aiTextScore([title,body].join(' '),terms);if(score>0)results.push({id,title,type,detail,score})};
 (data.tasks||[]).forEach(x=>add(x.id,x.title||'Untitled task','Task',[x.category,x.notes,x.due,x.priority].join(' '),x.done?'Completed':x.due?'Due '+dateFmt(x.due):'Open'));
 (data.notes||[]).forEach(x=>add(x.id,x.title||'Untitled note','Note',[x.subject,x.tags,x.content].join(' '),String(x.content||'').slice(0,140)));
 (data.memories||[]).forEach(x=>add(x.id,x.title||'Saved memory','Memory',[x.category,x.content].join(' '),String(x.content||'').slice(0,140)));
 (data.projects||[]).forEach(x=>add(x.id,x.name||x.title||'Project','Project',[x.description,x.status].join(' '),x.status||''));
 (data.documents||[]).forEach(x=>add(x.id,x.name||'Uploaded document','Document',[x.extractedText,x.summary,JSON.stringify(x.extractedJson||{})].join(' '),[x.type||'File',x.expiresOn?'Expires '+dateFmt(x.expiresOn):'No expiry date'].join(' · ')));
 (data.expenses||[]).forEach(x=>add(x.id,x.description||x.person||'Money record','Money',[x.category,x.person,x.kind,x.amount,x.date,x.dueDate].join(' '),[x.kind||'expense','₹'+Number(x.amount||0).toLocaleString('en-IN')].join(' · ')));
 return results.sort((a,b)=>b.score-a.score).slice(0,30);
}
function personalTimeline(){
 const rows=[],add=(date,type,title,detail,id)=>{if(date&&Number.isFinite(Number(date)))rows.push({date:Number(date),type,title,detail,id})};
 (data.documents||[]).forEach(x=>{add(x.created,'Document',x.name||'Uploaded document','Added to your vault',x.id);if(x.expiresOn)add(new Date(x.expiresOn+'T09:00:00').getTime(),'Expiry',x.name||'Document','Expiry / renewal date',x.id);if(x.summaryUpdatedAt)add(x.summaryUpdatedAt,'Summary',x.name||'Document','AI summary generated',x.id)});
 (data.notes||[]).forEach(x=>add(x.created||x.updated,'Note',x.title||'Note saved','Personal note',x.id));(data.memories||[]).forEach(x=>add(x.created,'Memory',x.title||'Saved memory','Personal memory',x.id));(data.tasks||[]).forEach(x=>add(x.created,'Task',x.title||'Task added',x.done?'Completed':'Task created',x.id));(data.projects||[]).forEach(x=>add(x.created,'Project',x.name||'Project','Project added',x.id));
 return rows.sort((a,b)=>b.date-a.date).slice(0,60);
}
function documentVault(){
 const query=String(window.vaultSearchQuery||''),results=query?phase5SearchResults(query):[],timeline=personalTimeline();
 return titleBlock('PERSONAL KNOWLEDGE','Document Vault','Search your One workspace, manage important files, and keep track of document dates.',btn('+ Upload files','quick-add-upload',true))+'<section class="card vault-search-card"><div class="eyebrow">UNIVERSAL SEARCH</div><h2>Find anything in One</h2><input id="vault-search" class="search" type="search" placeholder="Search notes, tasks, memories, projects and document contents…" value="'+esc(query)+'"><small class="muted">Search includes extracted PDF and image text, summaries and structured data.</small>'+(query?'<div class="vault-search-results">'+(results.length?results.map(x=>'<button class="vault-search-result" type="button" data-action="open-vault-result" data-id="'+esc(x.id)+'" data-type="'+esc(x.type)+'"><span><b>'+esc(x.title)+'</b><small>'+esc(x.type)+' · '+esc(x.detail)+'</small></span><span>Open ↗</span></button>').join(''):'<p class="muted">No matching records found.</p>')+'</div>':'')+'</section>'+
 '<section class="card document-upload-card"><div><h2>Your document library</h2><p class="muted">PDF and image uploads · text extraction and OCR · AI summaries · expiry tracking</p></div><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary upload-label" for="document-upload">＋ Upload PDF / image</label><button class="btn" data-action="enable-reminders">Enable reminders</button></div><input id="document-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/jpeg,image/png,image/webp" hidden><small id="document-upload-status" class="muted">PDF and images · max 12 MB each · scanned pages use OCR when available</small></section>'+
 '<div class="row vault-section-heading"><h2>Documents</h2><span class="muted">'+(data.documents||[]).length+' saved</span></div><input id="vault-document-search" class="search" type="search" placeholder="Search within uploaded documents…" value="'+esc(window.vaultDocumentQuery||'')+'"><div id="vault-documents">'+documentsCards()+'</div>'+
 '<section class="card vault-timeline"><div class="row"><div><div class="eyebrow">YOUR HISTORY</div><h2>Personal timeline</h2></div><span class="muted">'+timeline.length+' events</span></div>'+(timeline.length?'<ol>'+timeline.map(x=>'<li><span class="timeline-dot"></span><div><small class="muted">'+new Date(x.date).toLocaleString('en-IN')+' · '+esc(x.type)+'</small><b>'+esc(x.title)+'</b><span>'+esc(x.detail)+'</span></div></li>').join('')+'</ol>':empty('Your notes, documents, memories and projects will appear here as you add them.','◷'))+'</section>';
}
function knowledge(){return `${titleBlock('YOUR KNOWLEDGE','My Knowledge','Save notes, upload exam date sheets and ask questions from your files.',btn('+ New note','new-note',true))}<div class="card document-upload-card"><div><h2>Upload a notice or date sheet</h2><p class="muted">Upload a PDF or image. After extraction, ask about it from the main Ask My Brain page.</p></div><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary upload-label" for="document-upload">＋ Upload PDF / image</label><button class="btn" data-action="go-ask">Ask My Brain ↗</button></div><input id="document-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/jpeg,image/png,image/webp" hidden><small id="document-upload-status" class="muted">PDF and image files · max 12 MB each</small></div>${documentsCards()}<div class="toolbar"><input class="search" id="note-search" placeholder="Search notes, subjects, tags…" value="${esc(window.noteQuery||'')}"><select id="subject-filter" class="search" style="max-width:190px"><option value="">All subjects</option>${[...new Set(data.notes.map(n=>n.subject).filter(Boolean))].map(s=>`<option ${window.subjectFilter===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="notes-list" class="grid item-grid">${notesCards()}</div><p class="muted" style="font-size:11px;margin-top:18px">MVP note: notes are saved in your current browser, not synced to an online account.</p>`}
function uploadedItems(){return `${titleBlock('YOUR LIBRARY','Uploaded Items','PDFs and images you have uploaded to your knowledge base.',btn('Ask My Brain ↗','go-ask',true))}<div class="card document-upload-card"><div><h2>Upload a notice or date sheet</h2><p class="muted">Upload a PDF or image. After extraction, ask about it from the main Ask My Brain page.</p></div><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary upload-label" for="document-upload">＋ Upload PDF / image</label><button class="btn" data-action="go-ask">Ask My Brain ↗</button></div><input id="document-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/jpeg,image/png,image/webp" hidden><small id="document-upload-status" class="muted">PDF and image files · max 12 MB each</small></div>${documentsCards()}`}
function notesOnly(){return `${titleBlock('YOUR NOTES','Note','Your saved notes in one place. Uploaded PDFs and images are kept under Uploaded Items.',btn('+ New note','new-note',true))}<div class="toolbar"><input class="search" id="note-search" placeholder="Search notes, subjects, tags…" value="${esc(window.noteQuery||'')}"><select id="subject-filter" class="search" style="max-width:190px"><option value="">All subjects</option>${[...new Set(data.notes.map(n=>n.subject).filter(Boolean))].map(s=>`<option ${window.subjectFilter===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="notes-list" class="grid item-grid">${notesCards()}</div><p class="muted" style="font-size:11px;margin-top:18px">Notes are saved in your current browser.</p>`}
function safeNoteUrl(value){try{const url=new URL(String(value||'').trim());return ['http:','https:'].includes(url.protocol)?url.href:''}catch(_){return ''}}
function notesCards(){let q=(window.noteQuery||'').toLowerCase(),s=window.subjectFilter||'';let ns=[...data.notes].filter(n=>(!s||n.subject===s)&&(!q||[n.title,n.content,n.subject,n.tags].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.updated-a.updated);if(!ns.length)return `<div class="card" style="grid-column:1/-1">${empty(q?'No notes match your search.':'No notes yet. Try an example: “Remember my project idea is a campus event app.” Add your first note to keep it here.','▤')}${btn('+ Create a note','new-note',true)}</div>`;return ns.map(n=>`<article class="card note-card"><div class="row"><span class="tag blue">${esc(n.subject||'General')}</span><button class="btn small" data-action="edit-note" data-id="${n.id}">Edit</button></div><div class="note-title" style="margin-top:15px">${esc(n.title)}</div><p>${esc(n.content)}</p><div class="row"><small class="muted">${esc(n.tags||'No tags')}</small><button class="btn small" data-action="extract-note-actions" data-id="${n.id}">Find action items</button><button class="btn small danger" data-action="delete-note" data-id="${n.id}">Delete</button></div></article>`).join('')}
function tasks(){const all=[...(data.tasks||[])].sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;return (a.due||'9999').localeCompare(b.due||'9999')});const open=all.filter(t=>!t.done),done=all.filter(t=>t.done),expanded=window.taskSectionExpanded||'open';const renderGroup=(title,items,key)=>`<section class="card task-accordion"><button class="row task-section-toggle" type="button" data-action="toggle-task-section" data-id="${key}" aria-expanded="${expanded===key}" style="width:100%;border:0;background:transparent;text-align:left;cursor:pointer;padding:0"><h2>${title}</h2><span class="muted">${items.length}</span><span aria-hidden="true">${expanded===key?'▾':'▸'}</span></button>${expanded===key?`<div class="list" style="margin-top:14px">${items.length?items.map(t=>`${taskRow(t)}<div class="task-row-actions"><button class="btn small" data-action="share-task-whatsapp" data-id="${t.id}">WhatsApp</button><button class="btn small" data-action="share-task-telegram" data-id="${t.id}">Telegram</button><button class="btn small" data-action="edit-task" data-id="${t.id}">Edit</button> <button class="btn small danger" data-action="delete-task" data-id="${t.id}">Delete</button></div>`).join(''):empty('Nothing here yet. Add a task with a due date.','☑')}</div>`:''}</section>`;return `${titleBlock('YOUR TASKS','Tasks','See your tasks directly, with due dates and quick actions.',btn('+ Add task','new-task',true)+btn('Reminders','enable-reminders',false,true))}<div class="planner-summary"><div><b>${open.length}</b><span>Open tasks</span></div><div class="overdue-summary"><b>${open.filter(t=>t.due&&t.due<today()).length}</b><span>Overdue</span></div><div><b>${done.length}</b><span>Completed</span></div></div>${renderGroup('Open tasks',open,'open')}${renderGroup('Completed',done,'completed')}</div>`;}function plannerCalendar(){
 const base=window.plannerMonth||today().slice(0,7),[year,month]=base.split('-').map(Number),first=new Date(year,month-1,1),offset=(first.getDay()+6)%7,days=new Date(year,month,0).getDate(),selected=window.plannerSelectedDate||today();
 const monthLabel=first.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
 const cells=Array.from({length:42},(_,i)=>{const day=i-offset+1;if(day<1||day>days)return '<span class="planner-calendar-day is-blank" aria-hidden="true"></span>';const date=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'),tasks=(data.tasks||[]).filter(t=>t.due===date),moneyRows=(data.expenses||[]).filter(e=>e.date===date||e.dueDate===date),classes=['planner-calendar-day'];if(date===today())classes.push('is-today');if(date===selected)classes.push('is-selected');return '<button type="button" class="'+classes.join(' ')+'" data-action="planner-date" data-id="'+date+'" aria-label="'+date+', '+tasks.length+' tasks, '+moneyRows.length+' money records" aria-pressed="'+(date===selected)+'"><span class="planner-calendar-number">'+day+'</span><span class="planner-calendar-markers">'+(tasks.length?'<i class="task-marker" title="'+tasks.length+' tasks"></i>':'')+(moneyRows.length?'<i class="money-marker" title="'+moneyRows.length+' money records"></i>':'')+'</span></button>'}).join('');
 const taskRows=(data.tasks||[]).filter(t=>t.due===selected).sort((a,b)=>Number(a.done)-Number(b.done));
 const moneyRows=(data.expenses||[]).filter(e=>e.date===selected||e.dueDate===selected).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
 const taskMarkup=taskRows.length?taskRows.map(t=>'<button type="button" class="planner-date-record" data-action="edit-task" data-id="'+esc(t.id)+'"><span class="planner-date-record-icon task-record-icon">'+(t.done?'✓':'☑')+'</span><span><b>'+esc(t.title||'Untitled task')+'</b><small>'+(t.done?'Completed':t.due===today()?'Due today':'Task due')+' · '+esc(t.category||'General')+'</small></span><span class="planner-date-record-value">'+(t.done?'Done':'Open')+'</span></button>').join(''):'<p class="planner-date-empty">No tasks scheduled for this date.</p>';
 const moneyMarkup=moneyRows.length?moneyRows.map(e=>{const kind=e.kind||'expense',label=({expense:'Expense',income:'Income',lent:'Lent',borrowed:'Borrowed',lent_repayment:'Repayment received',borrowed_repayment:'Repayment made'})[kind]||'Money';return '<button type="button" class="planner-date-record" data-action="edit-expense" data-id="'+esc(e.id)+'"><span class="planner-date-record-icon money-record-icon">₹</span><span><b>'+esc(e.description||label)+'</b><small>'+label+(e.dueDate===selected&&e.date!==selected?' · Repayment due':' · '+(e.category||'Money'))+'</small></span><span class="planner-date-record-value">'+money(e.amount)+'</span></button>'}).join(''):'<p class="planner-date-empty">No money activity recorded for this date.</p>';
 const selectedLabel=new Date(selected+'T12:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
 return '<section class="card daily-calendar" aria-label="Calendar"><div class="planner-calendar-controls"><button type="button" data-action="planner-month" data-id="prev" aria-label="Previous month">‹</button><h2>'+esc(monthLabel)+'</h2><button type="button" data-action="planner-month" data-id="next" aria-label="Next month">›</button><button type="button" class="planner-calendar-today" data-action="planner-month" data-id="today">Today</button></div><div class="planner-calendar-grid planner-calendar-weekdays">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>'<span class="planner-calendar-weekday">'+x+'</span>').join('')+'</div><div class="planner-calendar-grid">'+cells+'</div><div class="planner-calendar-legend"><span><i class="task-marker"></i> Tasks</span><span><i class="money-marker"></i> Money activity</span></div></section><section class="card planner-selected-date"><div class="planner-selected-date-heading"><div><div class="eyebrow">SELECTED DAY</div><h2>'+esc(selectedLabel)+'</h2></div><button type="button" class="btn small" data-action="new-task">＋ Task</button></div><div class="planner-date-section"><h3>Tasks <span>'+taskRows.length+'</span></h3>'+taskMarkup+'</div><div class="planner-date-section"><h3>Money activity <span>'+moneyRows.length+'</span></h3>'+moneyMarkup+'</div></section>';
}
function planner(){
 const now=today(),all=[...(data.tasks||[])],open=all.filter(t=>!t.done),done=all.filter(t=>t.done);
 const addDays=n=>{const d=new Date(now+'T00:00:00');d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
 const weekEnd=addDays(7),overdue=open.filter(t=>t.due&&t.due<now).sort((a,b)=>a.due.localeCompare(b.due));
 const dueWeek=open.filter(t=>t.due&&t.due>=now&&t.due<=weekEnd).sort((a,b)=>a.due.localeCompare(b.due));
 const later=open.filter(t=>t.due&&t.due>weekEnd).sort((a,b)=>a.due.localeCompare(b.due));
 const noDate=open.filter(t=>!t.due).sort((a,b)=>(a.created||0)-(b.created||0));
 const view=window.plannerView||'Today',completedView=view==='Completed';const completedTasks=view==='Completed'?data.tasks.filter(t=>t.done):done;const total=all.length,doneCount=done.length,progress=total?Math.round(doneCount/total*100):0;
 const dateLabel=new Date(now+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short'}).toUpperCase();
 const card=t=>'<article class="daily-task-card '+(t.done?'is-complete':'')+'"><div class="daily-task-main">'+taskRow(t)+'</div><details class="daily-task-menu"><summary aria-label="More task actions" title="More options">⋮</summary><div class="daily-task-menu-pop"><button data-action="share-task-whatsapp" data-id="'+t.id+'">WhatsApp</button><button data-action="share-task-telegram" data-id="'+t.id+'">Telegram</button><button data-action="edit-task" data-id="'+t.id+'">Edit</button><button class="menu-delete" data-action="delete-task" data-id="'+t.id+'">Delete</button></div></details></article>';
 const group=(label,items)=>items.length?'<section class="daily-task-group"><div class="daily-group-heading"><span>'+label+'</span><b>'+items.length+'</b></div><div class="daily-task-stack">'+items.map(card).join('')+'</div></section>':'';
 let content;
 if(completedView)content=completedTasks.length?group('COMPLETED TASKS',completedTasks.sort((a,b)=>(b.completedAt||0)-(a.completedAt||0))):empty('No completed tasks yet. Completed tasks will appear here with their completion time.','✓');
 else if(view==='Overdue')content=group('OVERDUE',overdue)||empty('No overdue tasks. You are on track!','✓');
 else if(view==='Today')content=group('DUE TODAY',open.filter(t=>t.due===now))+group('OVERDUE',overdue)||empty('Nothing due today. Enjoy the breathing room!','✓');
 else if(view==='Tomorrow')content=group('DUE TOMORROW',open.filter(t=>t.due===addDays(1)))||empty('Nothing due tomorrow.','✓');
 else if(view==='Upcoming')content=group('DUE THIS WEEK',dueWeek)+group('LATER',later)+group('NO DUE DATE',noDate)||empty('No upcoming tasks.','✓');
 else content=group('OVERDUE',overdue)+group('DUE THIS WEEK',dueWeek)+group('LATER',later)+group('NO DUE DATE',noDate)||empty('No open tasks. You are all caught up!','✓');
 const tabs=['Today','Tomorrow','Upcoming','Overdue','All','Completed'];
 return '<div class="daily-planner-redesign"><div class="daily-planner-topbar">'+btn('♧ Reminders','enable-reminders',false,true)+'</div><div class="daily-planner-heading"><div class="eyebrow">'+dateLabel+'</div><h1>Daily planner</h1><p class="subtitle">Your tasks and money activity, organized by date.</p></div><section class="daily-progress-card"><div class="daily-progress-copy"><div><b>'+doneCount+' of '+total+'</b><strong>completed</strong></div><span>'+(open.length?'Next: '+esc([...open].filter(t=>t.due).sort((a,b)=>a.due.localeCompare(b.due))[0]?.title||'Open task'):'All tasks completed')+'</span></div><div class="daily-progress-track"><i style="width:'+progress+'%"></i></div><div class="daily-mini-stats"><button data-action="planner-view" data-id="All" aria-label="Show all open tasks"><b>'+open.length+'</b><span>Open</span></button><button class="is-overdue" data-action="planner-view" data-id="Overdue"><b>'+overdue.length+'</b><span>Overdue</span></button><button class="is-done" data-action="planner-view" data-id="Completed"><b>'+doneCount+'</b><span>Done</span></button></div></section><div class="daily-planner-content">'+content+'</div><div class="planner-tabs daily-filter-tabs" role="tablist" aria-label="Task views">'+tabs.map(x=>'<button class="planner-tab '+(view===x?'active':'')+'" data-action="planner-view" data-id="'+x+'" role="tab" aria-selected="'+(view===x)+'">'+x+'</button>').join('')+'</div>'+plannerCalendar()+'<button class="daily-floating-add" data-action="new-task">＋ <span>Add task</span></button></div>';
}function studyPlanner(){const sessions=[...(data.studySessions||[])].sort((a,b)=>(a.date||'').localeCompare(b.date||''));return `${titleBlock('STUDY ROUTINE','Study planner','Plan study blocks by subject, date and duration.',btn('+ Add study session','new-study',true))}<div class="card"><div class="list">${sessions.length?sessions.map(x=>`<div class="list-item"><div class="list-icon">📚</div><div class="list-copy"><b>${esc(x.subject)}</b><small>${dateFmt(x.date)} · ${esc(x.duration||'')}${x.duration?' min':''} · ${esc(x.topic||'')}</small></div><button class="btn small danger" data-action="delete-study" data-id="${x.id}">Remove</button></div>`).join(''):empty('No study sessions planned yet.','📚')}</div></div>`}
function backupRestore(){return `${titleBlock('YOUR DATA','Backup & restore','Export a portable copy, or safely restore a verified Student Brain backup.') }<div class="grid two-col backup-grid"><div class="card backup-card"><h2>Backup</h2><p class="muted">Export notes, tasks, study sessions, memories, documents and workspace records. Keep a copy outside this browser.</p>${btn('Download backup','export-data',true)}</div><div class="card backup-card"><h2>Restore</h2><p class="muted">Choose a One JSON backup. We validate it and save a safety snapshot before replacing current data.</p><input id="restore-file" type="file" accept=".json,application/json" class="search"><div id="restore-preview" class="restore-preview muted" role="status" aria-live="polite">No backup selected. Current workspace data will remain unchanged until you confirm.</div><div style="margin-top:12px">${btn('Restore backup','restore-data')}</div></div><div class="card backup-safety" style="grid-column:1/-1"><h2>Local data safety</h2><p class="muted">One stores workspace data on this device in this browser. Offline changes stay here. Export backups regularly, especially before clearing browser data or changing devices.</p><span class="tag amber">Local-first · Offline supported</span></div></div>`}function projects(){return `${titleBlock('YOUR WORKSPACES','Projects','Keep project notes, tasks and milestones connected.',btn('+ New project','new-project',true))}<div class="grid item-grid">${data.projects.length?[...data.projects].sort((a,b)=>b.updated-a.updated).map(projectCard).join(''):`<div class="card" style="grid-column:1/-1">${empty('No projects yet. Create one for your work project, personal goal or idea.','▣')}${btn('+ Create project','new-project',true)}</div>`}</div>`}
function expenseStat(label,num,note,icon,kind){return '<button type="button" class="card stat-card expense-quick-action" data-action="expense-quick-action" data-id="'+kind+'" title="'+(kind==='all'?'View all records':'Quick add')+'"><span class="row"><span class="stat-label">'+label+'</span><span class="stat-icon">'+icon+'</span></span><span class="stat-number">'+num+'</span><span class="stat-note">'+note+'<span class="stat-open-hint"> · '+(kind==='all'?'View all →':'Quick add +')+'</span></span></button>'}
function loanTracker(){const entries=(data.expenses||[]).filter(e=>['lent','borrowed','lent_repayment','borrowed_repayment'].includes(e.kind)).filter(e=>!window.loanPersonFilter||e.person===window.loanPersonFilter),people=new Map();for(const e of entries){const name=String(e.person||'Unknown').trim()||'Unknown',row=people.get(name)||{name,lent:0,borrowed:0,received:0,repaid:0,records:[],nextDue:null};if(e.kind==='lent')row.lent+=Number(e.amount||0);if(e.kind==='borrowed')row.borrowed+=Number(e.amount||0);if(e.kind==='lent_repayment')row.received+=Number(e.amount||0);if(e.kind==='borrowed_repayment')row.repaid+=Number(e.amount||0);if(e.dueDate&&(!row.nextDue||e.dueDate<row.nextDue))row.nextDue=e.dueDate;row.records.push(e);people.set(name,row)}const rows=[...people.values()].map(p=>({...p,owed:p.lent-p.received,owe:p.borrowed-p.repaid})).filter(p=>p.owed>0||p.owe>0).sort((a,b)=>a.name.localeCompare(b.name)),lent=rows.reduce((n,p)=>n+p.owed,0),borrowed=rows.reduce((n,p)=>n+p.owe,0),overdue=rows.reduce((n,p)=>n+p.records.filter(e=>e.dueDate&&e.dueDate<today()&&((e.kind==='lent'&&p.owed>0)||(e.kind==='borrowed'&&p.owe>0))).length,0);return `${titleBlock('PEOPLE & REPAYMENTS','Udhaar & Loan Tracker','Know who owes you, who you owe, repayment history and due dates.',btn('+ Add udhaar','new-expense',true))}${window.loanPersonFilter?`<div class="toolbar"><span class="tag blue">History: ${esc(window.loanPersonFilter)}</span><button class="btn small" data-action="loan-clear-filter">Show everyone</button></div>`:''}<div class="grid stats loan-stats">${expenseStat('You should receive',money(lent),'Outstanding lent amount','↗','lent')}${expenseStat('You should repay',money(borrowed),'Outstanding borrowed amount','↙','borrowed')}${expenseStat('People',rows.length,'With outstanding balances','♙','all')}${expenseStat('Overdue records',overdue,'Past due date','!','all')}</div><div class="loan-actions"><button class="btn primary" data-action="new-expense" data-id="lent">＋ I lent money</button><button class="btn" data-action="new-expense" data-id="borrowed">＋ I borrowed</button></div><div class="grid loan-people">${rows.length?rows.map(p=>`<article class="card loan-person-card"><div class="row"><div><div class="loan-person-name">${esc(p.name)}</div><small class="muted">${p.records.length} records</small></div><span class="tag ${p.owed>0?'green':'blue'}">${p.owed>0?'Owes you':'You owe'}</span></div><div class="loan-balance-grid"><div><small>To receive</small><b>${money(p.owed)}</b></div><div><small>To repay</small><b>${money(p.owe)}</b></div></div>${p.nextDue?`<p class="loan-due ${p.nextDue<today()?'overdue':''}">${p.nextDue<today()?'Overdue':'Next due'} · ${dateFmt(p.nextDue)}</p>`:''}<div class="loan-records">${p.records.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4).map(e=>`<div class="loan-record"><span>${esc(({lent:'Lent',borrowed:'Borrowed',lent_repayment:'Received',borrowed_repayment:'Repaid'}[e.kind]||'Record'))} · ${dateFmt(e.date)}</span><b>${money(e.amount)}</b></div>`).join('')}</div><div class="loan-card-actions"><button class="btn small" data-action="loan-repayment" data-id="${esc(p.name)}">＋ Add repayment</button><button class="btn small" data-action="loan-person-history" data-id="${esc(p.name)}">History</button></div></article>`).join(''):empty('No udhaar entries yet. Add money you lent or borrowed to start tracking balances.','₹')}</div><h2 class="loan-history-title">All udhaar transactions</h2><div class="card"><div class="list">${entries.sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<div class="list-item"><div class="list-copy"><b>${esc(e.description)}</b><small>${esc(e.person||'Unknown')} · ${esc(({lent:'Lent',borrowed:'Borrowed',lent_repayment:'Received repayment',borrowed_repayment:'Repaid'}[e.kind]||'Udhaar'))} · ${dateFmt(e.date)}${e.dueDate?' · Due '+dateFmt(e.dueDate):''}</small></div><b>${money(e.amount)}</b><button class="btn small" data-action="edit-expense" data-id="${e.id}">Edit</button><button class="btn small danger" data-action="delete-expense" data-id="${e.id}">×</button></div>`).join('')||empty('No history yet.','₹')}</div></div>`}
function moneyTabs(active){return '<div class="money-tabs" role="tablist" aria-label="Money sections">'+[['spending','Spending'],['income','Income'],['udhaar','Udhaar'],['budget','Budget & Savings'],['reports','Reports']].map(([id,label])=>'<button type="button" role="tab" aria-selected="'+(active===id)+'" class="money-tab '+(active===id?'active':'')+'" data-money-tab="'+id+'">'+label+'</button>').join('')+'</div>'}
function expenses(){
 const tab=window.moneyTab||'spending',month=Object.prototype.hasOwnProperty.call(window,'expenseMonth')?window.expenseMonth:today().slice(0,7),all=[...(data.expenses||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||'')),kind=e=>e.kind||'expense';
 if(tab==='udhaar')return moneyTabs(tab)+loanTracker();
 const monthRecords=all.filter(e=>e.date?.startsWith(month)),sum=(records,k)=>records.filter(e=>kind(e)===k).reduce((n,e)=>n+Number(e.amount||0),0);
 const spent=sum(monthRecords,'expense'),income=sum(monthRecords,'income'),lent=sum(monthRecords,'lent')-sum(monthRecords,'lent_repayment'),borrowed=sum(monthRecords,'borrowed')-sum(monthRecords,'borrowed_repayment');
 if(tab==='budget'){
  data.moneyBudgets=Array.isArray(data.moneyBudgets)?data.moneyBudgets:[];
  const budget=data.moneyBudgets.find(x=>x.month===month),limit=Number(budget?.amount||0),remaining=limit-spent,pct=limit?Math.min(100,Math.round(spent/limit*100)):0;
  return moneyTabs(tab)+titleBlock('PLAN YOUR MONEY','Budget & Savings','Set a monthly spending limit and see how much you have left.')+'<div class="toolbar"><label for="expense-month">Month</label><input id="expense-month" type="month" class="search" value="'+esc(month)+'"></div><section class="card money-budget-card"><div class="eyebrow">MONTHLY SPENDING BUDGET</div><div class="money-budget-number">'+money(spent)+' <small>spent</small></div><div class="money-budget-track"><span style="width:'+pct+'%"></span></div><div class="row"><span>'+money(limit)+' budget</span><b class="'+(remaining<0?'is-over-budget':'')+'">'+(limit?money(remaining)+' left':'Set a budget')+'</b></div><div class="money-budget-form"><label for="money-budget-amount">Monthly budget (₹)</label><input id="money-budget-amount" class="search" type="number" min="1" step="1" placeholder="e.g. 10000" value="'+(limit||'')+'"><button class="btn primary" type="button" data-action="save-money-budget">Save budget</button></div><p class="muted">Savings shown here are your unspent budget amount, not a bank balance.</p></section><div class="grid stats"><div class="card"><span class="stat-label">Income this month</span><div class="stat-number">'+money(income)+'</div></div><div class="card"><span class="stat-label">Unspent budget</span><div class="stat-number">'+(limit?money(Math.max(0,remaining)):'—')+'</div></div></div>';
 }
 if(tab==='reports'){
  const categories={};monthRecords.filter(e=>kind(e)==='expense').forEach(e=>categories[e.category||'Other']=(categories[e.category||'Other']||0)+Number(e.amount||0));
  const rows=Object.entries(categories).sort((a,b)=>b[1]-a[1]);
  return moneyTabs(tab)+titleBlock('MONEY INSIGHTS','Monthly reports','Review spending by category, income and your monthly balance.')+'<div class="toolbar"><input id="expense-month" type="month" class="search" value="'+esc(month)+'"></div><div class="grid stats"><div class="card"><span class="stat-label">Total spending</span><div class="stat-number">'+money(spent)+'</div></div><div class="card"><span class="stat-label">Income received</span><div class="stat-number">'+money(income)+'</div></div><div class="card"><span class="stat-label">Income − spending</span><div class="stat-number">'+money(income-spent)+'</div></div></div><div class="card"><h2>Spending by category</h2><div class="list">'+(rows.map(([name,value])=>'<div class="list-item"><div class="list-copy"><b>'+esc(name)+'</b><small>'+(spent?Math.round(value/spent*100):0)+'% of spending</small></div><b>'+money(value)+'</b></div>').join('')||empty('No spending data for this month.','₹'))+'</div></div>';
 }
 const filterKind=tab==='income'?'income':'expense',records=monthRecords.filter(e=>kind(e)===filterKind);
 return moneyTabs(tab)+titleBlock('EVERYDAY MONEY','Money Spending',tab==='income'?'Track salary, refunds and other money received.':'Track everyday expenses and spending in one place.',btn('+ Add transaction','new-expense',true))+'<div class="grid stats money-summary-grid">'+expenseStat('Spending this month',money(spent),month,'₹','expense')+expenseStat('You are owed',money(lent),'Lent less received repayments','↗','lent')+expenseStat('You owe others',money(borrowed),'Borrowed less repayments','↙','borrowed')+'<div class="card"><span class="stat-label">Income this month</span><div class="stat-number">'+money(income)+'</div><small class="stat-note">Money received this month</small></div></div><div class="toolbar"><input id="expense-month" type="month" class="search" style="max-width:210px" value="'+esc(month)+'">'+btn('Show all','all-expenses')+'</div><div class="card"><div class="list">'+(records.length?records.map(e=>'<div class="list-item"><div class="list-icon">₹</div><div class="list-copy"><b>'+esc(e.description)+'</b><small>'+esc(kind(e)==='income'?'Income received':'Expense')+' · '+esc(e.category||'Other')+' · '+dateFmt(e.date)+'</small></div><b>'+money(e.amount)+'</b><button class="btn small" data-action="edit-expense" data-id="'+e.id+'">Edit</button><button class="btn small danger" data-action="delete-expense" data-id="'+e.id+'">×</button></div>').join(''):empty('No '+(tab==='income'?'income':'spending')+' records for this month. Add your first transaction.','₹'))+'</div></div>';
}function ask(){const hasMessages=data.messages.length>0;return `<section class="chat-shell ${hasMessages?"has-messages":"is-empty"}" aria-label="Ask One chat"><header class="chat-intro"><button type="button" class="chat-back" data-page="overview" aria-label="Back to Today" title="Back to Today">←</button><div class="chat-brand-mark" aria-hidden="true">✦</div><div class="chat-intro-copy"><div class="eyebrow">YOUR PERSONAL ASSISTANT</div><h2>Ask One</h2><p>Ask about your saved notes, files, tasks, projects and money.</p></div><span class="chat-context-pill"><span aria-hidden="true">●</span> Saved context</span></header>${!hasMessages?`<div class="chat-welcome"><p>What would you like to know?</p><div class="suggestions"><button class="suggestion" data-question="Summarize my notes">Summarize my notes</button><button class="suggestion" data-question="What subjects have I saved?">My saved subjects</button><button class="suggestion" data-question="What should I work on next?">What should I work on next?</button><button class="suggestion" data-question="Who owes me money?">Who owes me money?</button><button class="suggestion" data-question="How much do I owe others?">How much do I owe others?</button></div></div>`:``}<div class="chat-messages" id="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">${data.messages.map((m,i)=>`<article class="chat-message-row ${m.role==='user'?'from-user':'from-one'}"><div class="bubble ${m.role==='user'?'user':'assistant'}"><div class="bubble-content">${formatChatText(m.content)}</div>${m.fileResults?.length?`<div class="chat-file-results">${m.fileResults.map(file=>`<button class="vault-search-result" type="button" data-action="open-uploaded-file" data-id="${esc(file.id)}"><span><b>${esc(file.name)}</b><small>${esc(file.type.toUpperCase())} · ${esc(file.tags.join(', '))}</small></span><span>Open ↗</span></button>`).join('')}</div>`:''}${m.sources?.length?`<span class="source">Sources: ${m.sources.map(esc).join(', ')}</span>`:``}</div></article>`).join('')}</div>${chatBusy?'<div class="bubble assistant typing-indicator" role="status" aria-live="polite"><span>One is thinking</span><span class="typing-dots" aria-hidden="true"> ···</span></div>':''}<form class="chat-form" id="chat-form"><input id="chat-input" aria-label="Message One" placeholder="Message One…" autocomplete="off"><button class="btn primary chat-send" type="submit" ${chatBusy?'disabled':''}><span>${chatBusy?'Thinking…':'Send'}</span><span aria-hidden="true">↗</span></button></form><div class="chat-note">Your message and relevant saved passages may be sent to Google Gemini to generate a reply. Google free-tier content may be used to improve Google products. Avoid sharing sensitive information and verify important answers with original sources.</div></section>`}
function personalMemory(){const memories=data.memories||[];return `${titleBlock('PERSONAL MEMORY','Personal memory','Save preferences and useful facts. Ask One can use them alongside your notes and saved documents.',btn('+ Add memory','new-memory',true))}<div class="card memory-explainer"><h2>Your personal memory, under your control</h2><p class="muted">Examples: preferred language, learning style, course goals, formatting preferences, or recurring context. Only add details you want saved in this browser.</p></div><div class="grid item-grid">${memories.length?memories.map(m=>`<article class="card memory-card"><div class="row"><span class="tag blue">${esc(m.category||'Preference')}</span><button class="btn small" data-action="edit-memory" data-id="${m.id}">Edit</button></div><h3>${esc(m.title)}</h3><p>${esc(m.content)}</p><div class="row"><small class="muted">Saved ${dateFmt(m.date||today())}</small><button class="btn small danger" data-action="delete-memory" data-id="${m.id}">Delete</button></div></article>`).join(''):`<div class="card" style="grid-column:1/-1">${empty('No personal memories yet. Add a preference or useful fact to help One tailor its answers.','✧')}</div>`}</div><p class="muted" style="font-size:11px;margin-top:15px">Memory is stored locally on this device and included in your workspace backup.</p>`}
function aiPrivacyControls(){const labels={notes:'Saved notes',tasks:'Tasks and reminders',projects:'Projects',documents:'Uploaded documents and OCR text',money:'Money and Udhaar records',memories:'Personal memories'};return '<section class="card"><h2>AI data sharing</h2><p class="muted" style="font-size:12px;line-height:1.6">Choose which workspace data One may include when sending a question to AI. Changes apply to future AI requests. Money sharing is off by default.</p>'+Object.entries(labels).map(([key,label])=>'<label class="list-item" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span>'+label+'</span><input type="checkbox" data-ai-share="'+key+'" '+((data.aiPrivacy||{})[key]!==false?'checked':'')+'></label>').join('')+'</section>'}
function settings(){return `${titleBlock('PROFILE & PREFERENCES','Settings','Manage your One account, companion app and data safety.')}<div class="card android-companion-card"><div class="row"><div class="list-icon">📱</div><div class="list-copy"><b>One SMS Sync for Android</b><small>Floating One bubble · Quick Notes · UPI SMS capture</small></div><span class="tag green">Available</span></div><p class="muted" style="font-size:12px;line-height:1.7;margin:12px 0">Install the companion app on your Android phone and sign in using the same One account. Enable the floating bubble or optional UPI SMS access from inside the app.</p><div class="actions"><a class="btn primary" href="https://github.com/Arbaj-k/one/releases/download/one-sms-sync-v0.1.0/app-debug.apk" target="_blank" rel="noopener">Download Android APK ↓</a><a class="btn" href="https://github.com/Arbaj-k/one/releases/tag/one-sms-sync-v0.1.0" target="_blank" rel="noopener">Release notes</a></div><small class="muted">Initial debug-signed release. Android may ask you to confirm installation from this source.</small></div><section class="card reminder-connections-card"><div class="row"><div class="list-copy"><h2>One notifications</h2><small>Task reminders in One and Android notification shade, including when One is in the background.</small></div><span class="tag blue">In-app + Android push</span></div><div class="notification-settings-preview"><span>♧</span><div><b>One notification centre</b><small>Unread count, reminder history and quick access to tasks</small></div></div><div class="actions"><button class="btn primary" type="button" data-action="enable-reminders">Enable Android notifications</button><button class="btn" type="button" data-action="open-notifications">View notifications</button></div><p class="muted" style="font-size:11px;line-height:1.6;margin:12px 0 0">Allow notifications when Android asks. Background push also requires the One push service to be configured on the server.</p></section><div class="grid two-col"><div class="card"><h2>Workspace</h2><div class="list-item"><div class="list-icon">✦</div><div class="list-copy"><b>Student Brain</b><small>Personal workspace</small></div><span class="tag green">Ready</span></div><p class="muted" style="font-size:12px;line-height:1.7;margin-top:15px">Your data is stored in this browser. Export regular backups to keep a copy.</p></div><div class="card"><h2>Data controls</h2><p class="muted" style="font-size:12px;line-height:1.7">Download a backup before clearing local data.</p><div class="actions">${btn('Export my data ↓','export-data',true)}${btn('Clear all data','clear-data')}</div></div></div><section class="card privacy-data-map"><h2>Privacy & personal data</h2><p class="muted" style="font-size:12px;line-height:1.65">Your account email and sign-in credentials are managed by Supabase Auth. Your workspace syncs to your private Supabase account. Selected AI context is sent to Google Gemini when you ask One a question.</p><div class="list-item"><div class="list-copy"><b>Stored on this device</b><small>Workspace cache, uploaded-file copies, offline queue and sign-in session.</small></div></div><div class="list-item"><div class="list-copy"><b>Sent to external services</b><small>Supabase for login/sync/files; Gemini for selected AI context; Google for Google sign-in; push providers for reminder delivery.</small></div></div><div class="list-item"><div class="list-copy"><b>Optional Android SMS sync</b><small>When enabled, parsed transaction details (not the full SMS body) are sent to One.</small></div></div><p class="muted" style="font-size:11px;line-height:1.6">Local workspace data is currently cached in browser storage for offline use. Browser storage is accessible to same-origin scripts; protect your device and avoid untrusted extensions.</p><a class="btn" href="docs/privacy-data-flow.md" target="_blank" rel="noopener">Read full data-flow map</a></section>${aiPrivacyControls()}`}function modal(title,body,saveLabel='Save'){const fab=document.querySelector('.floating-create-button');fab?.classList.add('is-hidden');document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal create-form-screen" role="dialog" aria-modal="true" aria-labelledby="edit-form-title"><div class="modal-head"><button type="button" class="modal-back-button" data-action="close-modal" aria-label="Back" title="Back"><span aria-hidden="true">←</span></button><h2 id="edit-form-title">${title}</h2></div><form id="edit-form">${body}<div class="modal-actions"><button class="btn primary modal-save-button" type="submit">${saveLabel}</button></div></form></section></div>`}
function field(label,name,value='',type='text',opts={}){let val=esc(value??'');if(type==='textarea')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><textarea name="${name}" ${opts.required?'required':''} placeholder="${esc(opts.placeholder||'')}">${val}</textarea></div>`;if(type==='select')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><select name="${name}">${opts.options.map(o=>{const parts=String(o).split('|'),v=parts.length>1?parts.shift():String(o),text=parts.length?parts.join('|'):String(o);return `<option value="${esc(v)}" ${v===String(value??'')?'selected':''}>${esc(text)}</option>`}).join('')}</select></div>`;return `<div class="field ${opts.full?'full':''}"><label>${label}</label><input name="${name}" type="${type}" value="${val}" ${opts.required?'required':''} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.accept?`accept="${esc(opts.accept)}"`:''} placeholder="${esc(opts.placeholder||'')}"></div>`}
function choiceField(label,name,value,options,segmented=false,optional=false){const choices=optional?['',...options]:options;return `<div class="field full choice-field ${segmented?'choice-segmented':''}"><label>${label}</label><input type="hidden" name="${name}" value="${esc(value??'')}"><div class="choice-options" role="group" aria-label="${label}">${choices.map(option=>{const v=String(option),caption=optional&&v===''?'None':v;return `<button type="button" class="choice-option ${String(value??'')===v?'is-selected':''}" data-choice-name="${name}" data-choice-value="${esc(v)}" aria-pressed="${String(value??'')===v?'true':'false'}">${esc(caption)}</button>`}).join('')}</div></div>`}
let editing=null,formType='';
function openKnowledgeEntry(){openForm('note');}
function openUploadForm(){const picker=document.createElement('input');picker.type='file';picker.accept='.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';picker.onchange=()=>{const file=picker.files?.[0];if(file)openFileMetadataDialog(file)};picker.click();}
function openMemoryForm(id){const item=id?(data.memories||[]).find(x=>x.id===id)||{}:{};editing=id||null;formType='memory';const body=field('Memory title','title',item.title,'text',{required:true,full:true,placeholder:'e.g. Preferred answer language'})+field('Type','category',item.category||'Preference','select',{options:['Preference','Personal context','Learning goal','Communication style','Other']})+field('Memory','content',item.content,'textarea',{required:true,full:true,placeholder:'e.g. Explain technical concepts in simple Hinglish with examples.'});modal(id?'Edit memory':'Add personal memory',body,id?'Save changes':'Save memory');}
function openForm(type,id){editing=id||null;formType=type;let obj=id?data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'].find(x=>x.id===id)||{}:{};let body='';
if(type==='note')body=field('Title (optional)','title',obj.title||'','text',{full:true,placeholder:'Give your note a title (optional)'})+field('Content','content',obj.content||'','textarea',{full:true,required:true,placeholder:'Write your note here…'});
if(type==='task')body=field('Task title','title',obj.title,'text',{required:true,full:true,placeholder:'e.g. Computer Networks assignment'})+choiceField('Category (optional)','category',obj.category||'Assignment',['Assignment','Exam','Project','Reading'],false,true)+field('Due date','due',obj.due,'date')+field('Reminder time','reminderTime',obj.reminderTime||'09:00','time')+field('Repeat','repeatRule',obj.repeatRule||'none','select',{options:['none|Does not repeat','daily|Daily','weekly|Weekly','monthly|Monthly']})+field('Notify before','notifyBeforeMinutes',String(obj.notifyBeforeMinutes??0),'select',{options:['0|At reminder time','10|10 minutes before','60|1 hour before','1440|1 day before']})+field('Related note (optional)','relatedNoteId',obj.relatedNoteId||'','select',{options:['|None',...(data.notes||[]).map(n=>n.id+'|'+(n.title||'Untitled note'))]})+field('Related document (optional)','relatedDocumentId',obj.relatedDocumentId||'','select',{options:['|None',...(data.documents||[]).map(d=>d.id+'|'+(d.name||'Untitled document'))]})+choiceField('Priority','priority',obj.priority||'Medium',['Low','Medium','High'],true,false)+field('Related project (optional)','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)].map(x=>x.includes('|')?x:x),full:true})+field('Notes (optional)','notes',obj.notes,'textarea',{full:true});
if(type==='study')body=field('Subject','subject','','text',{required:true,full:true})+field('Topic / chapter','topic','','text',{full:true})+field('Date','date',today(),'date',{required:true})+field('Duration (minutes)','duration','45','number',{required:true,min:1});
if(type==='project')body=field('Project name','name',obj.name,'text',{required:true,full:true})+field('Description','description',obj.description,'textarea',{full:true})+field('Status','status',obj.status||'In progress','select',{options:['In progress','On hold','Completed']})+field('Target date','targetDate',obj.targetDate,'date');
if(type==='expense')body=field('Transaction type','kind',obj.kind||'expense','select',{options:['expense|Expense / spending','income|Income received','lent|I lent money','borrowed|I borrowed money','lent_repayment|Money returned to me','borrowed_repayment|I repaid money']})+field('Description','description',obj.description,'text',{required:true,full:true,placeholder:'e.g. Lunch / Loan to Rahul'})+field('Person','person',obj.person||'','text',{full:true,placeholder:'Name of person (required for udhaar)'})+field('Amount (₹)','amount',obj.amount,'number',{required:true,min:0})+field('Category','category',obj.category||'Food','select',{options:['Food','Travel','Books & supplies','College fees','Entertainment','Shopping','Other','Udhaar','Repayment']})+field('Date','date',obj.date||today(),'date',{required:true})+field('Due date (udhaar)','dueDate',obj.dueDate||'','date')+field('Related project (optional)','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)] .map(x=>x.includes('|')?x:x),full:true});
const arr=data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'];const old=obj.projectId||'';body=body.replaceAll('value="'+esc(old)+'"','value="'+esc(old)+'"');
modal((id?'Edit ':'')+({note:'Note',task:'task',study:'study session',project:'project',expense:'expense'}[type]),body,id?'Save changes':'Create');const firstField=document.querySelector('#edit-form input:not([type=file]),#edit-form textarea,#edit-form select');if(firstField){firstField.removeAttribute('readonly');firstField.removeAttribute('disabled');firstField.focus();}}
async function saveForm(e){e.preventDefault();if(formType==='fileMeta'){const fd=new FormData(e.target),metadata=Object.fromEntries(fd.entries()),file=window.pendingOneFile;if(!String(metadata.name||'').trim()){toast('Naam is required');return}if(!file){toast('Choose a file again');return}const button=e.target.querySelector('.modal-save-button');if(button){button.disabled=true;button.textContent='Saving…'}saveFile(file,metadata).then(record=>{window.pendingOneFile=null;document.querySelector('#modal-root').innerHTML='';page='vault';window.vaultDocumentQuery='';render();toast('File saved to Uploaded Items')}).catch(error=>{if(button){button.disabled=false;button.textContent='Save file'}toast(error.message||'Could not save file')});return}if(formType==='fileRename'){const fd=new FormData(e.target),metadata=Object.fromEntries(fd.entries());if(!String(metadata.name||'').trim()){toast('Naam is required');return}if(renameFile(editing,metadata)){document.querySelector('#modal-root').innerHTML='';render();toast('File details updated')}return}if(formType==='quickUpload'){const files=Array.from(e.target.querySelector('[name=uploads]')?.files||[]);if(!files.length){toast('Choose at least one PDF or image');return}const invalid=files.find(f=>f.size>12*1024*1024||!(f.type==='application/pdf'||f.type.startsWith('image/')));if(invalid){toast(invalid.size>12*1024*1024?'Each file must be 12 MB or smaller':'Choose only PDF or image files');return}document.querySelector('#modal-root').innerHTML='';processUploadedDocuments(files);return}const fd=new FormData(e.target),v=Object.fromEntries(fd.entries()),key=(formType==='note'||formType==='quickKnowledge')?'notes':formType==='task'?'tasks':formType==='project'?'projects':'expenses';if(formType==='memory'){data.memories=data.memories||[];const record=editing?data.memories.find(x=>x.id===editing):null;if(record)Object.assign(record,v,{date:today(),updated:Date.now()});else data.memories.push({id:uid(),...v,date:today(),created:Date.now()});persist();if(window.OneAnalytics&&!editing)window.OneAnalytics.trackEvent('memory_created');document.querySelector('#modal-root').innerHTML='';page='memory';render();toast(editing?'Memory updated':'Memory saved');return}if(formType==='quickKnowledge'){v.subject='Knowledge';v.tags='knowledge';if(!String(v.content||'').trim()){toast('Enter content');return}if(!String(v.title||'').trim())v.title='Knowledge Entry';}let noteFiles=[];if(formType==='note'){v.title=String(v.title||'').trim();v.content=String(v.content||'').trim();if(!v.content){toast('Enter note content');return}delete v.links;delete v.noteLinks;delete v.noteFiles;delete v.attachment;delete v.attachmentName;delete v.attachmentType;delete v.attachmentData;delete v.subject;delete v.tags;}if(['task','expense'].includes(formType)&&v.projectId?.includes('|'))v.projectId=v.projectId.split('|')[0];if(!v.projectId)delete v.projectId;if(formType==='study'){data.studySessions=data.studySessions||[];data.studySessions.push({id:uid(),...v,created:Date.now()});persist();document.querySelector('#modal-root').innerHTML='';render();toast('Study session planned');return}if(formType==='expense'&&(!Number.isFinite(Number(v.amount))||Number(v.amount)<=0)){toast('Enter a valid amount');return}if(formType==='expense'){v.kind=v.kind||'expense';if(v.kind!=='expense'&&!String(v.person||'').trim()){toast('Enter the person name for lending or repayment');return}if(['lent','borrowed','lent_repayment','borrowed_repayment'].includes(v.kind)){v.person=String(v.person).trim();v.description=String(v.description||'').trim()||(({lent:'Lent to ',borrowed:'Borrowed from ',lent_repayment:'Received from ',borrowed_repayment:'Repaid to '}[v.kind]||'Udhaar with ')+v.person);v.category=v.kind.includes('repayment')?'Repayment':'Udhaar'}else delete v.dueDate}let obj=editing?data[key].find(x=>x.id===editing):null;if(obj)Object.assign(obj,v,{updated:Date.now()});else data[key].push({id:uid(),...v,done:false,updated:Date.now(),created:Date.now()});persist();if(formType==='task'){try{const shown=JSON.parse(localStorage.getItem(taskReminderStorageKey())||'{}');const savedTask=editing?data.tasks.find(t=>t.id===editing):data.tasks[data.tasks.length-1];if(savedTask){delete savedTask.snoozedUntil;Object.keys(shown).filter(key=>key.startsWith('task-'+savedTask.id+'-')).forEach(key=>delete shown[key]);persist();}localStorage.setItem(taskReminderStorageKey(),JSON.stringify(shown));}catch{}setTimeout(checkTaskReminders,0)}if(window.OneAnalytics&&!editing){const eventName={note:'note_created',task:'task_created',project:'project_created',expense:'expense_created'}[formType];if(eventName)window.OneAnalytics.trackEvent(eventName)}document.querySelector('#modal-root').innerHTML='';render();toast(editing?'Changes saved':'Created successfully');}
async function retryDocumentOCR(id){
 const doc=(data.documents||[]).find(d=>d.id===id);if(!doc)return;
 const picker=document.createElement('input');picker.type='file';picker.accept=doc.type==='pdf'?'.pdf':'image/*';
 picker.onchange=async()=>{
  const file=picker.files?.[0];if(!file)return;
  if(file.size>12*1024*1024){toast('File is over 12 MB');return}
  try{
   let extracted='';
   const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
   if(isPdf){
    if(!window.pdfjsLib)throw new Error('PDF reader unavailable. Refresh and retry.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    if(pdf.numPages>100)throw new Error('PDF exceeds 100 pages.');
    for(let p=1;p<=pdf.numPages;p++){
     const pg=await pdf.getPage(p),ct=await pg.getTextContent();
     let pageText=ct.items.filter(x=>String(x.str||'').trim()).map(x=>x.str).join(' ');
     if(pageText.trim().length<24&&window.Tesseract){
      try{
       const base=pg.getViewport({scale:1}),viewport=pg.getViewport({scale:Math.min(1.8,1800/base.width)});
       const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
       await pg.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
       const ocr=await runImageOCR(canvas);if(ocr.trim())pageText='[OCR]\n'+ocr.trim();
      }catch(ocrError){console.warn("Operation failed; diagnostic details redacted.")}
     }
     extracted+='\n[Page '+p+']\n'+(pageText.trim()||'[No readable text found.]')+'\n';
     pg.cleanup?.();
    }
   }else{
    if(window.Tesseract){try{extracted=await runImageOCR(file)}catch(ocrError){console.warn("Operation failed; diagnostic details redacted.")}}
   }
   await saveOriginalDocument(id,file);
   doc.extractedText=extracted.trim()||'[No readable text detected. Original file is available for AI analysis.]';
   doc.chunks=splitDocumentIntoChunks(doc.extractedText);doc.name=file.name;doc.mimeType=file.type||'';doc.size=file.size;doc.fileStored=true;doc.created=Date.now();
   persist();render();toast('Original file and extracted text refreshed');
  }catch(err){console.warn("Operation failed; diagnostic details redacted.");toast(err.message||'OCR retry failed')}
 };
 picker.click();
}

async function runImageOCR(file){
 const recognize=async source=>{let out;try{out=await window.Tesseract.recognize(source,'eng+hin')}catch(_){out=await window.Tesseract.recognize(source,'eng')}return out.data.text||''};
 const cleanText=value=>String(value||'').replace(/[\\t\\f\\v]+/g,' ').split(/\\r?\\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(line=>line&&!/^[|_~•·.\\-]{2,}$/.test(line)&&!/^([A-Z])\\1{3,}$/.test(line)).join('\\n').trim();
 let best=cleanText(await recognize(file));
 // If OCR is sparse, try enlarged grayscale and thresholded versions. These passes
 // improve legibility without sending visual artwork to the AI as an input.
 if(window.createImageBitmap){
  const bitmap=await createImageBitmap(file);
  try{
   const scale=Math.min(2.5,2400/Math.max(bitmap.width,bitmap.height));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),d=pixels.data;
   for(let i=0;i<d.length;i+=4){const gray=.299*d[i]+.587*d[i+1]+.114*d[i+2];d[i]=d[i+1]=d[i+2]=gray; }
   ctx.putImageData(pixels,0,0);
   const grayText=cleanText(await recognize(canvas));if(grayText.length>best.length)best=grayText;
   if(best.length<80){
    const threshold=ctx.getImageData(0,0,canvas.width,canvas.height),td=threshold.data;
    for(let i=0;i<td.length;i+=4){const v=td[i]>160?255:0;td[i]=td[i+1]=td[i+2]=v}
    ctx.putImageData(threshold,0,0);
    const highContrast=cleanText(await recognize(canvas));if(highContrast.length>best.length)best=highContrast;
   }
  }finally{bitmap.close?.()}
 }
 return best;
}

async function processUploadedDocuments(files,sourceNoteId=null){
 const list=Array.from(files||[]);if(!list.length)return;
 const setStatus=message=>{const status=document.querySelector('#quick-add-upload-status')||document.querySelector('#document-upload-status');if(status)status.textContent=message;const live=document.querySelector('#ocr-live-status');if(live)live.textContent=message};
 const setProgress=(percent,label)=>setStatus(label+' · '+Math.max(0,Math.min(100,Math.round(percent)))+'%');
 for(const file of list){
  if(!file||file.size===0){setStatus((file?.name||'Selected file')+' is empty.');toast('Empty file cannot be processed');continue}
  if(file.size>12*1024*1024){setStatus(file.name+' exceeds 12 MB.');toast('File is over 12 MB');continue}
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  if(!isPdf&&!['image/jpeg','image/png'].includes(file.type)&&!/\.(jpe?g|png)$/i.test(file.name)){setStatus('Unsupported file type. Upload a PDF or image.');toast('Unsupported file type');continue}
  setProgress(0,'Starting '+file.name);
  try{
   let extracted='';
   if(isPdf){
    if(!window.pdfjsLib){console.warn("Operation failed; diagnostic details redacted.");}else{
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    if(pdf.numPages>100){extracted='[This PDF has '+pdf.numPages+' pages. The original file is saved; split it into smaller files for text extraction.]';}
    for(let p=1;p<=pdf.numPages;p++){
     setProgress((p-1)/pdf.numPages*85,'Reading page '+p+' of '+pdf.numPages+' · '+file.name);
     const pdfPage=await pdf.getPage(p),content=await pdfPage.getTextContent();
     let pageText=content.items.filter(i=>String(i.str||'').trim()).map(i=>({text:i.str,x:i.transform?.[4]||0,y:i.transform?.[5]||0})).sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x).reduce((rows,it)=>{let row=rows.find(r=>Math.abs(r.y-it.y)<=3);if(!row){row={y:it.y,items:[]};rows.push(row)}row.items.push(it);return rows},[]).sort((a,b)=>b.y-a.y).map(row=>row.items.sort((a,b)=>a.x-b.x).map(it=>it.text).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
     if(pageText.trim().length<24&&window.Tesseract){
      try{
       setProgress((p-1)/pdf.numPages*85,'OCR scanning page '+p+' of '+pdf.numPages+' · '+file.name);
       const base=pdfPage.getViewport({scale:1}),viewport=pdfPage.getViewport({scale:Math.min(1.8,1800/base.width)});
       const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
       await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
       const ocr=await runImageOCR(canvas);if(ocr.trim())pageText='[OCR]\n'+ocr.trim();
      }catch(ocrError){console.warn("Operation failed; diagnostic details redacted.")}
     }
     extracted+='\n[Page '+p+']\n'+(pageText.trim()||'[No selectable text detected on this page.]')+'\n';pdfPage.cleanup?.();
    }
    }
   }else{
    setProgress(15,window.Tesseract?'Reading image text · '+file.name:'Saving original image for AI analysis · '+file.name);
    if(window.Tesseract){try{extracted=await runImageOCR(file)}catch(ocrError){console.warn("Operation failed; diagnostic details redacted.")}}
   }
   setProgress(88,'Saving '+file.name);const id=uid();let fileStored=false;
   try{await saveOriginalDocument(id,file);fileStored=true}catch(storageError){console.warn("Operation failed; diagnostic details redacted.")}
   const extractedText=extracted.trim()||'[No readable text extracted. '+(fileStored?'Original file is available for AI analysis.':'Try another browser or a clearer file.')+']';
   data.documents=data.documents||[];
   const extractedJson=documentTextToJSON(file.name,extractedText);
   data.documents.push({id,name:file.name,type:isPdf?'pdf':'image',mimeType:file.type||'',size:file.size,extractedText,extractedJson,chunks:splitDocumentIntoChunks(extractedText),created:Date.now(),sourceNoteId:sourceNoteId||null,sourceKind:sourceNoteId?'note-attachment':'uploaded-file',fileStored,jsonStatus:'text_extracted'});
   persist();if(window.OneAnalytics)window.OneAnalytics.trackEvent('document_uploaded');render();setProgress(92,'Extracting structured JSON for '+file.name);toast('File uploaded. Structuring and saving to Knowledge…');await convertDocumentToJSON(id);
  }catch(err){console.warn("Operation failed; diagnostic details redacted.");setStatus('Could not read '+file.name+': '+(err.message||'unknown error'));toast('Extraction failed. See upload status.')}
 }
}


function askDocument(id){
 const doc=(data.documents||[]).find(d=>d.id===id);if(!doc)return;
 const q=prompt('Ask Brain anything about '+doc.name);
 if(!q||!q.trim())return;
 page='ask';render();sendChat(q.trim(),id);
}

async function convertDocumentToJSON(id){
 const doc=(data.documents||[]).find(item=>item.id===id);if(!doc)return;
 doc.jsonStatus='processing';doc.jsonError='';persist();render();
 try{
  const token=await getStudentBrainAIToken();
  const response=await fetch(CLOUD_URL+'/functions/v1/document-json',{method:'POST',headers:{'Content-Type':'application/json','apikey':CLOUD_KEY,'Authorization':'Bearer '+token},body:JSON.stringify({name:doc.name,mimeType:doc.mimeType||(doc.type==='pdf'?'application/pdf':/\\.jpe?g$/i.test(doc.name)?'image/jpeg':'image/png'),extractedText:doc.extractedText})});
  let payload={};try{payload=await response.json()}catch{}
  if(!response.ok)throw new Error(payload.error||'Document conversion failed.');
  if(!payload.json||typeof payload.json!=='object'||Array.isArray(payload.json)||!payload.json.structured_data||typeof payload.json.structured_data!=='object')throw new Error('Generated JSON did not pass validation.');
  doc.extractedJson=payload.json;doc.jsonStatus='saved_to_knowledge';doc.jsonSavedToKnowledge=true;doc.jsonConvertedAt=Date.now();doc.jsonSavedAt=Date.now();doc.structuredSearchText=JSON.stringify(payload.json);persist();render();toast('Structured JSON saved to My Knowledge');
 }catch(error){doc.jsonStatus='error';doc.jsonError=String(error.message||'Conversion failed');persist();render();console.warn("Operation failed; diagnostic details redacted.");toast(error.message||'Could not convert document');}
}
function downloadDocumentJSON(id){
 const doc=(data.documents||[]).find(item=>item.id===id);if(!doc?.extractedJson){toast('Convert to JSON first');return}
 const blob=new Blob([JSON.stringify(doc.extractedJson,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=(doc.name||'document').replace(/\\.[^.]+$/,'')+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function copyDocumentJSON(id){
 const doc=(data.documents||[]).find(item=>item.id===id);if(!doc?.extractedJson){toast('Convert to JSON first');return}
 try{await navigator.clipboard.writeText(JSON.stringify(doc.extractedJson,null,2));toast('JSON copied')}catch{downloadDocumentJSON(id)}
}

function documentTextToJSON(name,text){
 const extractor=window.StudentBrainDocumentExtractor;
 if(!extractor||typeof extractor.extract!=='function'){
  console.warn("Operation failed; diagnostic details redacted.");
  return {document_name:String(name||'Untitled document'),schema_version:3,extraction_status:'extractor_unavailable',pages:[],structured_data:{key_value:[],tables:[],timetable:[],line_records:[]},extraction_notes:['The JSON extractor module did not load. Original extracted text is retained separately.']};
 }
 return extractor.extract(name,text);
}

function splitDocumentIntoChunks(text){
 const pages=String(text||'').split(/(?=\[Page\s+\d+\])/i),chunks=[];
 pages.forEach(pageBlock=>{
  const match=pageBlock.match(/^\[Page\s+(\d+)\]/i),page=match?Number(match[1]):null;
  const lines=pageBlock.replace(/^\[Page\s+\d+\]\s*/i,'').split(/\n+/).map(value=>value.replace(/\s+/g,' ').trim()).filter(Boolean);
  let block=[],lastHeader='';
  const flush=()=>{if(block.length){chunks.push({text:block.join('\n'),page});block=[]}};
  lines.forEach((line,index)=>{
   const header=/^(?:subject|course|paper|date|day|time|start|end|room|venue|semester)\b/i.test(line)||(/(?:\||\t)/.test(line)&&/\b(?:subject|course|paper|date|day|time|start|end|room|venue|semester)\b/i.test(line));
   const row=/[|\t]/.test(line)&&(/\d|[A-Z]{2,}/i.test(line));
   if(header){flush();lastHeader=line;return}
   if(row){
    flush();
    block=lastHeader?[lastHeader,line]:[line];
    flush();
    lastHeader='';
    return;
   }
   if(block.length&&block.join('\n').length+line.length>700)flush();
   block.push(line);
   if(block.join('\n').length>=420)flush();
  });
  flush();
 });
 return chunks;
}
function extractStructuredTables(text){
 const tables=[];
 const pages=String(text||'').split(/(?=\[Page\s+\d+\])/i);
 for(const pageBlock of pages){
  const pageMatch=pageBlock.match(/^\[Page\s+(\d+)\]/i),page=pageMatch?Number(pageMatch[1]):null;
  const lines=pageBlock.replace(/^\[Page\s+\d+\]\s*/i,'').split(/\n+/).map(value=>value.trim()).filter(Boolean);
  // Keep interior empty cells: filtering them out silently shifts values into the wrong columns.
  const splitRow=line=>{
   let cells=line.includes('|')?line.split('|'):line.includes('\t')?line.split('\t'):line.split(/\s{2,}/);
   cells=cells.map(value=>value.trim());
   if(line.includes('|')){
    if(cells[0]==='')cells.shift();
    if(cells[cells.length-1]==='')cells.pop();
   }
   return cells;
  };
  const isSeparator=row=>row.length>0&&row.every(value=>/^:?-{3,}:?$/.test(value));
  for(let index=0;index<lines.length-1;index++){
   const header=splitRow(lines[index]);
   const likelyHeader=header.length>=3&&header.length<=8&&header.some(value=>/subject|course|paper|date|day|time|start|end|amount|total|room|venue|semester|exam/i.test(value));
   if(!likelyHeader||isSeparator(header))continue;
   const rows=[];
   for(let rowIndex=index+1;rowIndex<lines.length;rowIndex++){
    const row=splitRow(lines[rowIndex]);
    if(isSeparator(row))continue;
    if(row.length<2||row.length>header.length)break;
    rows.push(Array.from({length:header.length},(_,column)=>row[column]??''));
   }
   if(rows.length)tables.push({page,columns:header,rows});
   index+=rows.length;
  }
 }
 return tables.slice(0,30);
}
function extractTimetableData(text){
 const records=[];
 const lines=String(text||'').split(/\n+/).map(value=>value.trim()).filter(Boolean);
 const parseTime=value=>{const match=String(value||'').match(/(\d{1,2}:\d{2}\s*[AP]M)/i);return match?match[1].toUpperCase().replace(/\s+/g,' '):''};
 for(const line of lines){
  const match=line.match(/\b(All\s+)?(AEC|VAC|SEC|Open\s+Elective(?:\s+Courses)?)\s*[-:–—|]\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*(?:\(([^)]+)\))?\s*[-:–—|]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[-:–—|]\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if(match)records.push({course:match[2].replace(/\s+/g,' ').trim().toUpperCase().replace('OPEN ELECTIVE COURSES','OPEN ELECTIVE'),date:match[3].replace(/[/-]/g,'.'),day:match[4]||'',start:parseTime(match[5]),end:parseTime(match[6]),raw:line});
 }
 return records;
}
const AI_STOP_WORDS=new Set(['what','when','where','which','does','this','that','from','with','tell','show','about','please','the','and','for','are','was','is','in','on','of','your','have','could','should','would','can','find','search','me','my','brain','ask','file','uploaded','document','exam','paper','test','hai','kya','bata','do','or','to','a','an','as','at','by','it','be','summarize','summary','explain','ka','ki','ke','ko','se','mein','mera','meri','mere','btao','batao','dikhao','konsa','kaunsa','kab','kahan','kitna','kitne','hoga','hogi','tha','thi','the','please']);
const AI_QUERY_SYNONYMS={
 timetable:['schedule','exam','date','time','paper'],
 time:['samay','timing','waqt','baje'],
 date:['din','tareekh'],
 subject:['course','paper','vishay'],
 exam:['paper','test','pariksha'],
 marks:['score','number'],
 summary:['short','brief','saar'],
 explain:['samjhao','samjha','meaning'],
 due:['deadline','lastdate'],
 task:['kaam','todo','assignment'],
 spend:['kharch','kharcha','expense'],
 borrowed:['udhaar','loan'],
 lent:['udhaar','diya']
};
function aiNormalizeQuery(value){
 return String(value||'').toLowerCase().normalize('NFKD')
  .replace(/[़ँं]/g,'')
  .replace(/[^a-z0-9\u0900-\u097f\s]/g,' ')
  .split(/\s+/).filter(Boolean);
}
function aiQueryTerms(question){
 const tokens=aiNormalizeQuery(question),expanded=[...tokens];
 for(const token of tokens)for(const synonym of (AI_QUERY_SYNONYMS[token]||[]))expanded.push(synonym);
 const joined=tokens.join(' ');
 if(/(kab hai|date kya|exam kab)/.test(joined))expanded.push('date','schedule','exam');
 if(/(kitne baje|time kya|timing kya)/.test(joined))expanded.push('time','start','end');
 if(/(samjha do|samjhao|matlab kya)/.test(joined))expanded.push('explain','meaning');
 return [...new Set(expanded.filter(token=>token.length>1&&!AI_STOP_WORDS.has(token)))].slice(0,36);
}
function aiTextScore(text,terms){
 if(!terms.length)return 0;
 const normalized=aiNormalizeQuery(text),words=new Set(normalized);let score=0;
 for(const term of terms){
  if(words.has(term))score+=2;
  else if(term.length>=4&&normalized.some(word=>word.includes(term)))score+=0.5;
 }
 return score/Math.sqrt(terms.length);
}
function aiQueryIntent(question){
 const raw=String(question||'').toLowerCase(),tokens=aiNormalizeQuery(raw);
 const intent={terms:aiQueryTerms(question),subject:[],
  date:/\b(date|when|kab|tareekh|din|schedule|timetable)\b/.test(raw),
  time:/\b(time|timing|start|end|baje|samay|waqt|kitne)\b/.test(raw),
  table:/\b(table|row|column|list|all|every|subjects|papers|courses|saare|sabhi)\b/.test(raw),
  page:false,question:String(question||'')};
 const aliases={aec:['aec','ability enhancement course'],vac:['vac','value added course'],sec:['sec','skill enhancement course'],'open elective':['open elective','open elective courses','oe']};
 for(const [subject,variants] of Object.entries(aliases))if(variants.some(alias=>raw.includes(alias)))intent.subject.push(subject);
 const requestedPage=raw.match(/\b(?:page|panna)\s*(\d+)/i);
 if(requestedPage){intent.page=true;intent.pageNumber=Number(requestedPage[1]);}
 intent.terms=[...new Set([...intent.terms,...tokens.filter(token=>/^\d{1,4}$/.test(token))])].slice(0,40);
 return intent;
}
function aiChunkIntentScore(chunk,intent){
 const text=String(chunk.text||''),lower=text.toLowerCase();
 let score=aiTextScore(text,intent.terms);
 if(intent.subject.length){
  for(const subject of intent.subject)if(lower.includes(subject))score+=8;
  if(intent.subject.some(subject=>lower.includes(subject))&&/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text))score+=4;
 }
 if(intent.date&&/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text))score+=3;
 if(intent.time&&/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(text))score+=3;
 if(intent.table&&/(?:\||\t|\s{2,})/.test(text))score+=2;
 if(intent.page&&Number(chunk.page)===intent.pageNumber)score+=12;
 return score;
}
function aiRankDocumentChunks(chunks,question){
 const intent=aiQueryIntent(question);
 return (chunks||[]).map((chunk,index)=>({...chunk,index,score:aiChunkIntentScore(chunk,intent)}))
  .filter(chunk=>String(chunk.text||'').trim())
  .sort((a,b)=>b.score-a.score||a.index-b.index);
}
function aiBuildDocumentEvidence(documents,question,targetDocId=null,limits={}){
 const intent=aiQueryIntent(question),maxDocs=limits.maxDocs??6,maxChunks=limits.maxChunks??24,maxChars=limits.maxChars??30000;
 const candidates=(documents||[]).filter(doc=>doc&&doc.id&&(!targetDocId||doc.id===targetDocId)).map(doc=>{
  const sourceChunks=Array.isArray(doc.chunks)&&doc.chunks.length?doc.chunks:splitDocumentIntoChunks(doc.extractedText||'');
  const ranked=aiRankDocumentChunks(sourceChunks,question),matching=ranked.filter(chunk=>chunk.score>0);
  return {doc,matching,docScore:aiTextScore((doc.name||'')+' '+(doc.extractedText||''),intent.terms)};
 }).filter(item=>item.matching.length>0).sort((a,b)=>b.matching[0].score-a.matching[0].score||b.docScore-a.docScore);
 const picked=[],seen=new Set();
 for(const item of candidates.slice(0,maxDocs)){
  const first=item.matching[0];picked.push({...first,doc:item.doc});seen.add(item.doc.id+':'+first.index);
 }
 const global=candidates.flatMap(item=>item.matching.map(chunk=>({...chunk,doc:item.doc,docScore:item.docScore}))).sort((a,b)=>b.score-a.score||b.docScore-a.docScore||a.index-b.index);
 for(const hit of global){
  if(picked.length>=maxChunks)break;
  const key=hit.doc.id+':'+hit.index;if(seen.has(key))continue;
  picked.push(hit);seen.add(key);
 }
 const evidence=[];let total=0;
 for(const hit of picked){
  if(evidence.length>=maxChunks)break;
  const label='File: '+hit.doc.name+(hit.page?' · Page '+hit.page:''),block='['+label+']\n'+hit.text;
  if(total+block.length>maxChars)continue;
  total+=block.length;evidence.push({...hit,label});
 }
 return {intent,evidence,documents:[...new Set(evidence.map(hit=>hit.doc.id))],chars:total};
}
async function buildStudentBrainAIRequest(question,targetDocId=null){
 const terms=aiQueryTerms(question),allDocs=(data.documents||[]).filter(doc=>doc&&doc.id);
const docList=(data.documents||[]).filter(doc=>doc&&doc.id&&doc.extractedJson&&(!targetDocId||doc.id===targetDocId));
 const normalizedQuery=String(question||'').toLowerCase().replace(/[^a-z0-9\\u0900-\\u097f]+/g,' ').trim();
 const stopWords=new Set(['the','and','for','from','with','what','when','where','which','who','how','does','did','are','was','were','this','that','these','those','tell','show','give','please','about','document','file','hai','kya','ka','ki','ke','ko','me','mai','mein','par','se','kaun','kab','kahan','batao','bata','mujhe','mera','meri','mere']);
 const qTokens=normalizedQuery.split(/\\s+/).filter(token=>token.length>2&&!stopWords.has(token));
 const rankedJson=docList.map(doc=>{
  const searchable=JSON.stringify(doc.extractedJson).toLowerCase();
  const tokenHits=qTokens.reduce((sum,token)=>sum+(searchable.includes(token)?1:0),0);
  const phraseHit=normalizedQuery.length>5&&searchable.includes(normalizedQuery)?2:0;
  return {doc,score:tokenHits+phraseHit};
 }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,targetDocId?1:3);
 const jsonDocuments=rankedJson.map(({doc})=>({source:'Document JSON: '+doc.name,name:doc.name,document_type:doc.extractedJson.document_type,structured_data:doc.extractedJson.structured_data,source_pages:doc.extractedJson.source_pages,warnings:doc.extractedJson.warnings}));

 const projectCandidates=(data.projects||[]).map(project=>({project,score:aiTextScore([project.name,project.description].join(' '),terms)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
 const contextProject=projectCandidates.length&&projectCandidates[0].score>=2?projectCandidates[0].project:null;
 const isProjectLinked=item=>!!contextProject&&(item.projectId===contextProject.id||item.relatedProjectId===contextProject.id||(Array.isArray(item.projectIds)&&item.projectIds.includes(contextProject.id)));
 const retrieval=aiBuildDocumentEvidence(allDocs,question,targetDocId,{maxDocs:targetDocId?1:6,maxChunks:targetDocId?24:24,maxChars:39000});
 if(!targetDocId&&contextProject){
  const linkedDocs=allDocs.filter(doc=>isProjectLinked(doc)&&!retrieval.evidence.some(hit=>hit.doc.id===doc.id)).slice(0,3);
  for(const doc of linkedDocs){
   const text=String(doc.extractedText||doc.summary||'').slice(0,6000);
   if(text)retrieval.evidence.push({doc,label:'File: '+doc.name+' · linked to project '+(contextProject.name||contextProject.title||''),text});
  }
 }
 const documents=[],sources=[];
 let totalChars=0,inlineFile;
 for(const hit of retrieval.evidence){
  const doc=hit.doc,label=hit.label,block='['+label+']\\n'+hit.text;
  if(totalChars+block.length>39000)continue;
  let target=documents.find(entry=>entry.id===doc.id);
  if(!target){
   target={id:doc.id,name:doc.name,type:doc.type||'file',
    content:'',json:doc.extractedJson||null,tables:extractStructuredTables(doc.extractedText||'').slice(0,12),
    timetable:extractTimetableData(doc.extractedText||'').slice(0,30)};
   documents.push(target);
  }
  target.content+=(target.content?'\\n\\n':'')+block;
  totalChars+=block.length;
  if(!sources.includes(label))sources.push(label);
 }
 // If a relevant uploaded image is matched, attach its locally saved original to Gemini.
 // OCR can miss menu labels, mixed Hindi/English text, and table/column relationships.
 // Only send the best-matching image, and only when it is already stored locally.
 const queryLooksLikeMealMenu=/(mess|menu|meal|dinner|lunch|breakfast|thursday|thrusday|khana|raat ka|रात|खाना|मेस)/i.test(String(question||''));
 const originalCandidate=allDocs.find(doc=>doc.id===retrieval.documents[0])||
  (queryLooksLikeMealMenu?allDocs.filter(doc=>doc.type==='image'&&doc.fileStored).sort((a,b)=>Number(b.created||0)-Number(a.created||0))[0]:null);
 if(originalCandidate){
  const matchedDoc=originalCandidate;
  if(matchedDoc&&matchedDoc.type==='image'&&matchedDoc.fileStored){
   try{
    const original=await getOriginalDocument(matchedDoc.id);
    const blob=original?.blob;
    const mimeType=String(original?.type||matchedDoc.mimeType||'').toLowerCase();
    if(blob&&/^image\/(jpeg|png|webp)$/.test(mimeType)&&blob.size<=3*1024*1024){
     const label='File: '+matchedDoc.name+' · original file';
     inlineFile={name:matchedDoc.name,mimeType,dataBase64:await fileToBase64(blob)};
     if(!sources.includes(label))sources.push(label);
    }
   }catch(fileError){console.warn("Operation failed; diagnostic details redacted.")}
  }
 }
 const rankedNotes=(data.notes||[]).map(note=>({note,score:aiTextScore([note.title,note.subject,note.tags,note.content].join(' '),terms)+(isProjectLinked(note)?100:0)})).sort((a,b)=>b.score-a.score||Number(b.note.updated||0)-Number(a.note.updated||0));
 // Avoid flooding general questions with unrelated personal notes.
 const notes=rankedNotes
  .filter(item=>terms.length>0&&item.score>0)
  .slice(0,10)
  .map(({note})=>({
   source:'Note: '+(note.title||'Untitled note'),
   title:String(note.title||''),
   subject:String(note.subject||''),
   tags:String(note.tags||''),
   content:String(note.content||'').slice(0,2400)
  }));
 const overviewIntent=/\b(?:summari[sz]e|daily briefing|my day|overview|what should i do|today'?s priorities)\b/i.test(question);
 const asksProjects=overviewIntent||/\b(?:project|projects|milestone|progress)\b/i.test(question);
 const asksTasks=overviewIntent||asksProjects||/\b(?:task|tasks|todo|to-do|deadline|due|planner|today|tomorrow|kal|aaj|priority|pending|overdue|schedule|assignment|homework)\b/i.test(question);
 const asksMoney=overviewIntent||/\b(?:money|expense|expenses|spent|spending|udhaar|owe|lent|borrowed|budget|rupees?|rs\.?|₹|payment|paid)\b/i.test(question);
 const asksMemories=/\b(?:remember|memory|memories|preference|previously|before|last time|what did i tell)\b/i.test(question);
 const asksRoutines=overviewIntent||/\b(?:habit|habits|routine|routines|study session|focus session)\b/i.test(question);
 const taskPool=(data.tasks||[]);
 let selectedTasks=[];
 if(asksTasks){
  const ranked=taskPool.map(task=>({task,score:aiTextScore([task.title,task.category,task.notes,task.due].join(' '),terms)}));
  const matches=ranked.filter(item=>item.score>0).sort((a,b)=>b.score-a.score||String(a.task.due||'9999').localeCompare(String(b.task.due||'9999')));
  if(overviewIntent){
   const nextWeek=new Date(today()+'T00:00:00');nextWeek.setDate(nextWeek.getDate()+7);
   const weekKey=nextWeek.getFullYear()+'-'+String(nextWeek.getMonth()+1).padStart(2,'0')+'-'+String(nextWeek.getDate()).padStart(2,'0');
   selectedTasks=taskPool.filter(task=>!task.done&&(!task.due||task.due<=weekKey)).sort((a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999'))).slice(0,25);
  }else selectedTasks=(matches.length?matches.map(item=>item.task):taskPool.slice().sort((a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999')))).slice(0,40);
 }
 const tasks=selectedTasks.map(task=>{const source='Task: '+String(task.title||'Untitled task');sources.push(source);return {source,title:task.title||'',category:task.category||'',due:task.due||null,priority:task.priority||'Medium',completed:!!task.done,notes:String(task.notes||'').slice(0,500)}});
 let selectedProjects=[];
 if(asksProjects){
  const ranked=(data.projects||[]).map(project=>({project,score:aiTextScore([project.name,project.title,project.description,project.status].join(' '),terms)}));
  const matches=ranked.filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
  selectedProjects=(matches.length?matches.map(item=>item.project):ranked.map(item=>item.project)).slice(0,15);
 }
 const projects=selectedProjects.map(project=>{const source='Project: '+String(project.name||project.title||'Untitled project');sources.push(source);return {source,name:project.name||project.title||'',description:String(project.description||'').slice(0,700),status:project.status||'In progress',targetDate:project.targetDate||null}});
 let selectedMemories=[];
 if(asksMemories){
  const ranked=(data.memories||[]).map(memory=>({memory,score:aiTextScore([memory.title,memory.category,memory.content].join(' '),terms)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
  selectedMemories=(ranked.length?ranked.map(item=>item.memory):(data.memories||[])).slice(0,15);
 }
 const memories=selectedMemories.map(memory=>{const source='Personal memory: '+String(memory.title||'Memory');sources.push(source);return {source,title:memory.title||'',category:memory.category||'',content:String(memory.content||'').slice(0,700)}});
 const studySessions=asksRoutines?(data.studySessions||[]).slice(-15).map(session=>Object.fromEntries(Object.entries(session||{}).filter(([key,value])=>!['id','created','updated'].includes(key)&&value!==null&&value!==undefined))):[];
 if(studySessions.length)sources.push('Study sessions');
 const expenses=asksMoney?(data.expenses||[]).slice(-80).map(expense=>({description:expense.description||'',category:expense.category||'',person:expense.person||'',kind:expense.kind||'expense',amount:expense.amount||0,date:expense.date||'',dueDate:expense.dueDate||''})):[];
 if(expenses.length)sources.push('Money & Udhaar');
 const intelligence={dailyPlan:overviewIntent?phase4DailyPlan().answer:undefined,projectRisks:asksProjects?phase4ProjectRisks().answer:undefined,spendingInsights:asksMoney?phase4SpendingInsights().answer:undefined};
 return {workspace:{today:today(),notes,tasks,projects,memories,studySessions,expenses,documents,jsonDocuments,intelligence},sources:[...new Set([...sources,...jsonDocuments.map(item=>item.source)])].slice(0,40),inlineFile};
}
async function requestStudentBrainAI(question,targetDocId=null){
 const token=await getStudentBrainAIToken(),context=await buildStudentBrainAIRequest(question,targetDocId);
 const privacy={notes:true,tasks:true,projects:true,documents:true,money:false,memories:true,...(data.aiPrivacy||{})};
 const selectedWorkspace={...context.workspace};
 if(!privacy.notes)selectedWorkspace.notes=[];
 if(!privacy.tasks)selectedWorkspace.tasks=[];
 if(!privacy.projects)selectedWorkspace.projects=[];
 if(!privacy.documents){selectedWorkspace.documents=[];selectedWorkspace.jsonDocuments=[]}
 if(!privacy.money)selectedWorkspace.expenses=[];
 if(!privacy.memories)selectedWorkspace.memories=[];
 if(!privacy.tasks)selectedWorkspace.intelligence={...selectedWorkspace.intelligence,dailyPlan:undefined};
 if(!privacy.projects)selectedWorkspace.intelligence={...selectedWorkspace.intelligence,projectRisks:undefined};
 if(!privacy.money)selectedWorkspace.intelligence={...selectedWorkspace.intelligence,spendingInsights:undefined};
 const sourceAllowed=source=>(privacy.notes||!source.startsWith('Note: '))&&(privacy.tasks||!source.startsWith('Task: '))&&(privacy.projects||!source.startsWith('Project: '))&&(privacy.memories||!source.startsWith('Personal memory: '))&&(privacy.money||!['Money & Udhaar','Study sessions'].includes(source))&&(privacy.documents||!(/^(?:File: |Document JSON: )/.test(source)));
 const body={message:question,workspace:{...selectedWorkspace,today:today(),timezone:'Asia/Kolkata',dateInterpretation:'Interpret aaj/today as workspace.today. Interpret kal/tomorrow as the next calendar day for future reminders; interpret kal/yesterday only when the user clearly describes a past event (e.g. diya tha, hua tha, yesterday). Never claim data is not uploaded when the user is asking to create a reminder or briefing; use the local workspace action flow.'},allowedSources:context.sources.filter(sourceAllowed),inlineFile:privacy.documents?context.inlineFile:undefined};
 let response,networkError;
 const endpoint=CLOUD_URL+'/functions/v1/student-brain-ai';
 // AI requests are read-only: retry once on a transient transport/5xx failure.
 for(let attempt=0;attempt<2;attempt++){
  try{
   response=await fetch(endpoint,{
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':CLOUD_KEY,'Authorization':'Bearer '+token},
    body:JSON.stringify(body)
   });
   networkError=null;
  }catch(error){networkError=error;response=null}
  if(response&&![502,503,504].includes(response.status))break;
  if(attempt===0){
   await new Promise(resolve=>setTimeout(resolve,700));
   continue;
  }
 }
 if(!response){
  const detail=String(networkError?.message||'').toLowerCase();
  if(networkError?.name==='AbortError')throw new Error('The AI request timed out. Check your connection and retry.');
  if(detail.includes('failed to fetch')||networkError instanceof TypeError){
   throw new Error('Could not reach the Supabase AI endpoint after a retry. Check your internet connection and confirm that the student-brain-ai Edge Function is deployed and its CORS settings allow this website. Your saved data remains local.');
  }
  throw new Error('The AI connection could not be opened after a retry. Check your connection and try again.');
 }
 if([502,503,504].includes(response.status)){
  let detail='';
  try{const errorBody=await response.clone().json();detail=typeof errorBody?.error==='string'?errorBody.error:''}catch{}
  throw new Error((detail||'The AI service returned HTTP '+response.status+' after a retry.')+' Your saved data remains local; please try again shortly.');
 }
 let result={};
 try{result=await response.json()}catch{
  if(!response.ok)throw new Error('AI service returned HTTP '+response.status+' without a readable response. Verify the Edge Function deployment and CORS configuration.');
  throw new Error('AI service returned an unreadable response. Please retry.');
 }
 if(!response.ok){
  if(response.status===404)throw new Error('The student-brain-ai Edge Function was not found. Deploy it to the configured Supabase project, then retry.');
  if(response.status===401||response.status===403)throw new Error(result.error||'AI session was rejected. Refresh the page and retry; check the function authentication settings if this continues.');
  throw new Error(result.error||('AI request failed (HTTP '+response.status+').'));
 }
 if(typeof result.answer!=='string'||!result.answer.trim())throw new Error('AI returned an empty answer. Please try again.');
 return {answer:result.answer.trim(),sources:Array.isArray(result.sources)?result.sources.filter(source=>typeof source==='string').slice(0,20):[]};
}
function isStructuredWorkspaceQuestion(question){
 return /\b(spend|spent|spending|spending pattern|spending insight|spending trend|category breakdown|compare.*(?:spend|expense)|budget insight|where.*money go|project risk|projects at risk|behind schedule|what should i do|plan my day|plan today|plan my day|daily plan|prioriti[sz]e my tasks|aaj kya karu|search|find|look for|where is|locate|workspace|memory|memories|expense|expenses|money|rupees?|rs\.?|kharch|kharcha|transaction|transactions|budget|udhaar|lent|lending|borrow|borrowed|loan|repay|repaid|repayment|outstanding|owe|owed|who owes|kitna|diye|diya|task|tasks|todo|to-do|pending|unfinished|incomplete|overdue|deadline|reminder|remind me|planner)\b/i.test(question);
}
function knowledgeAnswerCompleteness(answer,question){
 const q=String(question||'').toLowerCase(),a=String(answer||'').toLowerCase();
 const asksForTime=/\b(time|timing|start|end|when|samay|kab)\b/.test(q),asksDate=/\b(date|day|when|kab|tarikh)\b/.test(q);
 const missing=[];
 if(asksDate&&!/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(a))missing.push('date');
 if(asksForTime&&!/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(a))missing.push('time');
 return {complete:missing.length===0,missing};
}
function extractMoneyPerson(question){
 const raw=String(question||'');
 const patterns=[/\bto\s+([a-z][a-z'-]*)/i,/\b(?:diye|diya|gave|lent|udhaar)\s+(?:hai\s+)?([a-z][a-z'-]*)\s+ko\b/i,/^\s*([a-z][a-z'-]*)\s+ko\b/i,/\b([a-z][a-z'-]*)\s+ko\s+(?:kitna|how much)\b/i];
 for(const pattern of patterns){const match=raw.match(pattern);if(match)return match[1]}
 return '';
}
function phase4SearchWorkspace(question){
 const raw=String(question||'').trim(),terms=aiQueryTerms(raw);
 const cleaned=raw.replace(/^\s*(?:please\s+)?(?:search(?:\s+for)?|find|look\s+for|where\s+is|show\s+me|locate)\s*/i,'').replace(/\b(?:in|across|inside)\s+(?:my\s+)?(?:workspace|one|everything|all records)\b/ig,'').trim();
 const queryTerms=aiQueryTerms(cleaned).length?aiQueryTerms(cleaned):terms;
 if(!queryTerms.length)return {answer:'Search ke liye ek naam ya keyword batao. Example: Search for Hapn project.',sources:[]};
 const results=[];
 const add=(text,source,score,detail='')=>{if(score>0)results.push({text,source,score,detail})};
 (data.tasks||[]).forEach(item=>add(item.title||'Untitled task','Task · Planner',aiTextScore([item.title,item.category,item.notes,item.due,item.priority].join(' '),queryTerms),[item.done?'Completed':'Open',item.due?'Due '+dateFmt(item.due):'No due date',item.priority||'Medium'].join(' · ')));
 (data.notes||[]).forEach(item=>add(item.title||'Untitled note','Note · Notes',aiTextScore([item.title,item.subject,item.tags,item.content].join(' '),queryTerms),String(item.content||'').slice(0,220)));
 (data.memories||[]).forEach(item=>add(item.title||'Saved memory','Memory · Personal Memory',aiTextScore([item.title,item.category,item.content].join(' '),queryTerms),String(item.content||'').slice(0,220)));
 (data.projects||[]).forEach(item=>add(item.name||item.title||'Untitled project','Project · Projects',aiTextScore([item.name,item.title,item.description,item.status].join(' '),queryTerms),[item.status||'In progress',item.targetDate?'Target '+dateFmt(item.targetDate):'No target date'].join(' · ')));
 (data.documents||[]).forEach(item=>add(item.name||'Uploaded item','File · Uploaded Items',aiTextScore([item.name,item.extractedText,item.summary,JSON.stringify(item.extractedJson||{})].join(' '),queryTerms),String(item.summary||item.extractedText||'').slice(0,220)));
 (data.expenses||[]).forEach(item=>add(item.description||item.person||'Money record','Money · Money & Udhaar',aiTextScore([item.description,item.category,item.person,item.kind,item.amount,item.date,item.dueDate].join(' '),queryTerms),[item.kind||'expense','₹'+Number(item.amount||0).toLocaleString('en-IN'),item.person||'',item.date||''].filter(Boolean).join(' · ')));
 results.sort((a,b)=>b.score-a.score);
 const selected=results.slice(0,8);
 return selected.length?{answer:'I found these matching records in your One workspace:\n'+selected.map((item,i)=>(i+1)+'. '+item.text+'\n   '+item.detail+'\n   Source: '+item.source).join('\n\n'),sources:[...new Set(selected.map(item=>item.source))]}:{answer:'No matching saved records found for "'+cleaned+'". Try a shorter keyword or a different spelling.',sources:[]};
}
function phase4DailyPlan(){
 const open=(data.tasks||[]).filter(t=>!t.done);
 const ranked=open.map(task=>{
  const days=task.due?Math.ceil((new Date(task.due+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000):null;
  const priority=String(task.priority||'Medium').toLowerCase();
  const score=(priority==='high'?5:priority==='medium'?2:0)+(days===null?0:days<0?10:days===0?8:days<=2?6:days<=7?3:0);
  return {task,days,score};
 }).sort((a,b)=>b.score-a.score||(a.days??999)-(b.days??999)).slice(0,7);
 const lines=ranked.map((item,i)=>{const t=item.task,when=item.days===null?'No due date':item.days<0?'Overdue by '+Math.abs(item.days)+' day(s)':item.days===0?'Due today': 'Due in '+item.days+' day(s)';return (i+1)+'. '+t.title+' — '+when+' · '+(t.priority||'Medium')});
 return {answer:ranked.length?'Suggested plan based on saved deadlines and priorities:\n'+lines.join('\n')+'\n\nThis is a suggested order, not an automatic change to your tasks.': 'No open tasks found. Your planner is clear.',sources:['Tasks & Planner']};
}
function phase4SpendingInsights(){
 const now=today(),month=now.slice(0,7),previous=addDaysToDate(month+'-01',-1).slice(0,7);
 const expenses=(data.expenses||[]).filter(e=>(e.kind||'expense')==='expense');
 const dayOfMonth=Number(now.slice(8,10)),priorMonthEnd=addDaysToDate(addDaysToDate(previous+'-01',32).slice(0,7)+'-01',-1);
 const comparablePriorEnd=addDaysToDate(previous+'-01',Math.min(dayOfMonth,Number(priorMonthEnd.slice(8,10)))-1);
 const current=expenses.filter(e=>String(e.date||'').startsWith(month)&&String(e.date)<=now),prior=expenses.filter(e=>String(e.date||'').startsWith(previous)&&String(e.date)<=comparablePriorEnd);
 const total=rows=>rows.reduce((n,e)=>n+Number(e.amount||0),0),currentTotal=total(current),priorTotal=total(prior);
 const byCategory=rows=>{const map=new Map();for(const e of rows){const key=String(e.category||'Uncategorized');map.set(key,(map.get(key)||0)+Number(e.amount||0))}return [...map.entries()].sort((a,b)=>b[1]-a[1])};
 const cats=byCategory(current),priorCats=new Map(byCategory(prior));
 const lines=cats.slice(0,5).map(([name,amount])=>{const before=priorCats.get(name)||0,change=before?Math.round((amount-before)/before*100):null;return name+': ₹'+amount.toLocaleString('en-IN')+(change===null?' · no previous-month baseline':' · '+(change>0?'+':'')+change+'% vs last month')});
 const delta=priorTotal?Math.round((currentTotal-priorTotal)/priorTotal*100):null;
 return {answer:'Spending insights for '+month+':\nThis month: ₹'+currentTotal.toLocaleString('en-IN')+'\nPrevious month: ₹'+priorTotal.toLocaleString('en-IN')+(delta===null?'\nNo previous-month baseline yet.':'\nChange: '+(delta>0?'+':'')+delta+'%')+'\n\nTop categories:\n'+(lines.length?lines.join('\n'):'No expense records for this month.')+'\n\nThese figures use only saved expense records; they are not bank transactions.',sources:['Money & Udhaar']};
}
function phase4ProjectRisks(){
 const todayDate=today(),projects=(data.projects||[]).filter(p=>String(p.status||'In progress').toLowerCase()!=='completed');
 const risks=projects.map(project=>{
  const tasks=(data.tasks||[]).filter(t=>t.projectId===project.id),open=tasks.filter(t=>!t.done),overdue=open.filter(t=>t.due&&t.due<todayDate),dueSoon=open.filter(t=>t.due&&t.due>=todayDate&&t.due<=addDaysToDate(todayDate,7));
  const targetDays=project.targetDate?Math.ceil((new Date(project.targetDate+'T00:00:00')-new Date(todayDate+'T00:00:00'))/86400000):null;
  const reasons=[];if(overdue.length)reasons.push(overdue.length+' overdue task(s)');if(targetDays!==null&&targetDays<0&&open.length)reasons.push('target date passed');else if(targetDays!==null&&targetDays<=7&&open.length)reasons.push('target date within '+targetDays+' day(s)');if(dueSoon.length)reasons.push(dueSoon.length+' task(s) due this week');
  return {project,open:open.length,total:tasks.length,done:tasks.length-open.length,reasons,level:overdue.length||targetDays<0?'High':reasons.length?'Watch':'On track'};
 }).filter(item=>item.reasons.length).sort((a,b)=>(a.level==='High'?-1:1)-(b.level==='High'?-1:1));
 return {answer:risks.length?'Project risk check:\n'+risks.slice(0,8).map((item,i)=>(i+1)+'. '+(item.project.name||'Untitled project')+' — '+item.level+'\n   '+item.reasons.join(', ')+' · '+item.done+'/'+item.total+' tasks completed').join('\n\n')+'\n\nProjects without linked tasks or target dates may have limited risk visibility.': 'No deadline risks detected in your active projects based on saved task due dates and project targets.',sources:['Projects','Tasks & Planner']};
}
const ASK_ONE_INTENT_MAP={
 tasks:['task','tasks','todo','to do','kaam','काम','pending','due','deadline','complete','completed','done','finish','remind','reminder','yaad dilao','yaad dilana','assignment'],
 notes:['note','notes','likha','likhi','likhe','yaad','memo','idea','save kiya','saved note','नोट','लिखा','विचार'],
 projects:['project','projects','milestone','progress','plan','planning','प्रोजेक्ट','परियोजना'],
 routines:['routine','routines','habit','habits','daily','roz','roj','subah','raat','streak','रोज','सुबह','रात','आदत'],
 money:['paisa','paise','kharcha','kharch','expense','expenses','income','budget','balance','spent','salary','udhaar','loan','rupees','rupee','money','payment','paisa','पैसा','पैसे','खर्चा','खर्च','आमदनी','उधार'],
 files:['file','files','pdf','image','photo','document','documents','upload','uploaded','bill','bills','dikhao','dikhado','kahan','where','picture','scan','receipt','फाइल','दस्तावेज']
};
function askOneNormalize(query){
 return String(query||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
}
function askOneLevenshtein(a,b){
 if(Math.abs(a.length-b.length)>1)return 2;
 let previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const current=[i];let rowMin=i;
  for(let j=1;j<=b.length;j++){const value=Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));current[j]=value;rowMin=Math.min(rowMin,value)}
  if(rowMin>1)return 2;previous=current;
 }
 return previous[b.length];
}
function detectIntent(query){
 const tokens=askOneNormalize(query),scores={};
 for(const [intent,keywords] of Object.entries(ASK_ONE_INTENT_MAP)){
  let score=0;
  for(const keyword of keywords){
   const variants=askOneNormalize(keyword);
   if(variants.length>1){if(String(query||'').toLowerCase().includes(keyword.toLowerCase()))score+=2;continue}
   const key=variants[0];if(!key)continue;
   if(tokens.some(token=>token===key))score+=2;
   else if(tokens.some(token=>token.length>=3&&key.length>=3&&(token.includes(key)||key.includes(token))))score+=1;
   else if(tokens.some(token=>token.length>=3&&key.length>=3&&askOneLevenshtein(token,key)<=1))score+=1;
  }
  scores[intent]=score;
 }
 const highest=Math.max(0,...Object.values(scores)),winners=Object.keys(scores).filter(key=>scores[key]===highest&&highest>0);
 return {intent:winners.length===1?winners[0]:null,scores,ambiguous:winners.length>1,matched:winners};
}
function askOneDateFromQuery(query){
 const q=String(query||'').toLowerCase(),base=new Date(today()+'T12:00:00');
 if(/\b(?:yesterday|kal\s+tha|beete\s+kal)\b/.test(q))base.setDate(base.getDate()-1);
 else if(/\b(?:tomorrow|kal|parso|parson)\b/.test(q))base.setDate(base.getDate()+( /\b(?:parso|parson)\b/.test(q)?2:1));
 else if(!/\b(?:today|aaj|आज)\b/.test(q))return '';
 return base.getFullYear()+'-'+String(base.getMonth()+1).padStart(2,'0')+'-'+String(base.getDate()).padStart(2,'0');
}
function askOneRecordText(item){
 return Object.entries(item||{}).filter(([,value])=>value!==null&&value!==undefined&&['string','number','boolean'].includes(typeof value)).map(([key,value])=>key+' '+value).join(' ').toLowerCase();
}
function askOneRelevant(records,query,ignoreWords=[]){
 const tokens=askOneNormalize(query),ignored=new Set([...ignoreWords,...['what','whats','show','me','list','all','the','my','is','are','was','were','for','of','in','on','at','to','a','an','and','or','please','kya','ka','ki','ke','hai','hain','tha','thi','the','batao','dikhao','kitna','kitne','kitni','wala','wali','wale','mera','meri','mere','today','tomorrow','yesterday','aaj','kal','parso','parson','this','that','how','much','much','total','pending','incomplete','open','completed','complete','done','task','tasks','todo','note','notes','project','projects','routine','routines','habit','habits','money','expense','expenses','spent','paisa','paise','kharcha','kharch','income','budget','balance','salary','udhaar','daily','roz','subah','raat']]);
 const terms=tokens.filter(token=>!ignored.has(token)&&token.length>1);
 if(!terms.length)return records.slice().sort((a,b)=>Number(b.updated||b.created||0)-Number(a.updated||a.created||0)).slice(0,8);
 return records.map(item=>{const words=askOneNormalize(askOneRecordText(item));let score=0;for(const term of terms){if(words.includes(term))score+=2;else if(words.some(word=>word.length>=3&&term.length>=3&&(word.includes(term)||term.includes(word))))score+=1;else if(words.some(word=>word.length>=3&&term.length>=3&&askOneLevenshtein(word,term)<=1))score+=1}return {item,score}}).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(row=>row.item);
}

function searchFiles(query){
 const tokens=askOneNormalize(query).filter(token=>!['file','files','pdf','image','photo','document','documents','upload','uploaded','bill','bills','show','me','dikhao','dikhado','kahan','where','is','my','the','please'].includes(token)&&token.length>1);
 return (data.documents||[]).map(file=>{
  const text=askOneNormalize([file.name,file.originalName,(file.tags||[]).join(' '),file.note].join(' '));
  let score=0;
  for(const token of tokens){if(text.includes(token))score+=2;else if(text.some(word=>word.length>=3&&token.length>=3&&(word.includes(token)||token.includes(word))))score+=1;else if(text.some(word=>word.length>=3&&token.length>=3&&askOneLevenshtein(word,token)<=1))score+=1}
  return {file,score};
 }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||Number(b.file.created||0)-Number(a.file.created||0)).slice(0,12).map(row=>row.file);
}
async function saveFile(file,metadata){
 if(!file||!metadata)throw new Error('Choose a file and enter its name.');
 if(file.size>5*1024*1024)throw new Error('File size limit is 5 MB. Choose a smaller file.');
 const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
 const validImage=['image/jpeg','image/png','image/webp'].includes(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name);
 if(!isPdf&&!validImage)throw new Error('Only PDF, JPG, PNG and WEBP files are supported.');
 const id=uid();
 await saveOriginalDocument(id,file);
 const record={id,name:String(metadata.name||'').trim(),tags:String(metadata.tags||'').split(',').map(x=>x.trim()).filter(Boolean),note:String(metadata.note||'').trim(),type:isPdf?'pdf':'image',mimeType:file.type|| (isPdf?'application/pdf':'image/'+(file.name.split('.').pop()||'jpeg')),size:file.size,originalName:file.name,createdAt:Date.now(),created:Date.now(),fileStored:true,extractedText:'',extractedJson:null,chunks:[]};
 data.documents=data.documents||[];data.documents.push(record);persist();return record;
}
function renameFile(id,metadata){
 const record=(data.documents||[]).find(item=>item.id===id);if(!record)return false;
 const name=String(metadata.name||'').trim();if(!name)return false;
 record.name=name;record.tags=String(metadata.tags||'').split(',').map(x=>x.trim()).filter(Boolean);record.note=String(metadata.note||'').trim();record.updated=Date.now();persist();return true;
}
async function deleteFile(id){
 const record=(data.documents||[]).find(item=>item.id===id);if(!record)return false;
 await removeOriginalDocument(id);data.documents=data.documents.filter(item=>item.id!==id);persist();return true;
}
async function openUploadedFile(id,download=false){
 const record=(data.documents||[]).find(item=>item.id===id);if(!record)return;
 const stored=await getOriginalDocument(id);if(!stored?.blob){toast('Original file is not available on this device.');return}
 const url=URL.createObjectURL(stored.blob);
 if(download){const link=document.createElement('a');link.href=url;link.download=record.originalName||record.name||'file';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return}
 const win=window.open(url,'_blank','noopener');if(!win){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.click()}setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function openFileMetadataDialog(file){
 if(!file)return;
 if(file.size>5*1024*1024){toast('File size limit is 5 MB. Choose a smaller file.');return}
 const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
 const preview=isPdf?'<div class="file-upload-preview"><span style="font-size:30px">📄</span><span>'+esc(file.name)+'</span></div>':'<div class="file-upload-preview"><img alt="Selected file preview" src="'+URL.createObjectURL(file)+'" style="max-width:100%;max-height:130px;object-fit:contain;border-radius:10px"><span>'+esc(file.name)+'</span></div>';
 window.pendingOneFile=file;formType='fileMeta';editing=null;
 modal('Save file',preview+field('Naam','name',file.name,'text',{required:true,full:true})+field('Tags / Keywords','tags','','text',{full:true,placeholder:'bijli bill, 2025, ghar'})+field('Note','note','','textarea',{full:true,placeholder:'Add a short note (optional)'})+'<small class="muted">Maximum file size: 5 MB</small><div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" data-action="close-modal">Cancel</button></div>','Save file');
 const input=document.querySelector('#edit-form [name=name]'),button=document.querySelector('#edit-form .modal-save-button');
 if(input&&button){const update=()=>button.disabled=!input.value.trim();input.addEventListener('input',update);update()}
}

function answerQuery(intent,query){
 const q=String(query||'').toLowerCase(),date=askOneDateFromQuery(query);
 const describe=(items,formatter)=>items.map((item,index)=>(index+1)+'. '+formatter(item)).join('\n');
 if(intent==='tasks'){
  let rows=(data.tasks||[]);
  if(/\b(?:pending|incomplete|unfinished|open|baaki|bacha|bachi)\b/.test(q))rows=rows.filter(item=>!item.done);
  else if(/\b(?:completed|complete|done|finished|ho gaya|kar diya)\b/.test(q))rows=rows.filter(item=>item.done);
  if(date)rows=rows.filter(item=>item.due===date);
  rows=askOneRelevant(rows,query,ASK_ONE_INTENT_MAP.tasks);
  return {answer:rows.length?'Tasks:\n'+describe(rows,item=>(item.title||'Untitled task')+' — '+(item.done?'Completed':'Pending')+' · '+(item.due?dateFmt(item.due):'No due date')):'Mujhe iske baare mein kuch nahi mila, aap Tasks, Notes, Projects, Routines ya Money try kar sakte ho.',sources:['Tasks & Planner']};
 }
 if(intent==='notes'){
  const rows=askOneRelevant(data.notes||[],query,ASK_ONE_INTENT_MAP.notes);
  return {answer:rows.length?'Matching notes:\n'+describe(rows,item=>(item.title||'Untitled note')+(item.subject?' · '+item.subject:'')+' — '+String(item.content||'').slice(0,420)):'Mujhe iske baare mein kuch nahi mila, aap Tasks, Notes, Projects, Routines ya Money try kar sakte ho.',sources:['Notes & Memory']};
 }
 if(intent==='projects'){
  const rows=askOneRelevant(data.projects||[],query,ASK_ONE_INTENT_MAP.projects);
  return {answer:rows.length?'Projects:\n'+describe(rows,item=>(item.name||item.title||'Untitled project')+(item.description?' — '+String(item.description).slice(0,300):'')+(item.status?' · '+item.status:'')):'Mujhe iske baare mein kuch nahi mila, aap Tasks, Notes, Projects, Routines ya Money try kar sakte ho.',sources:['Projects']};
 }
 if(intent==='routines'){
  const rows=askOneRelevant(data.studySessions||[],query,ASK_ONE_INTENT_MAP.routines);
  return {answer:rows.length?'Routine / activity records:\n'+describe(rows,item=>(item.title||item.name||item.subject||'Activity')+(item.date?' · '+dateFmt(item.date):'')+(item.duration?' · '+item.duration+' min':'')):'Mujhe iske baare mein kuch nahi mila, aap Tasks, Notes, Projects, Routines ya Money try kar sakte ho.',sources:['Routines & Activity']};
 }
 if(intent==='files'){
  const rows=searchFiles(query);
  return {answer:rows.length?'Matching files ('+rows.length+'):\n'+rows.map((file,index)=>(index+1)+'. '+file.name+' · '+(file.type||'file').toUpperCase()+' · '+(file.tags||[]).join(', ')).join('\n'):'Is naam ki koi file nahi mili.',sources:['Uploaded Items'],fileResults:rows.map(file=>({id:file.id,name:file.name,type:file.type,tags:file.tags||[]}))};
 }
 if(intent==='money'){
  let rows=(data.expenses||[]);
  if(date)rows=rows.filter(item=>item.date===date||item.dueDate===date);
  const searchRows=askOneRelevant(rows,query,ASK_ONE_INTENT_MAP.money);
  if(date&&/\b(?:spent|spending|kharcha|kharch|expense|expenses|kitna|total)\b/.test(q)){
   const expenses=rows.filter(item=>(item.kind||'expense')==='expense').reduce((sum,item)=>sum+Number(item.amount||0),0);
   const income=rows.filter(item=>item.kind==='income').reduce((sum,item)=>sum+Number(item.amount||0),0);
   const details=searchRows.length?'\n\nRecords:\n'+describe(searchRows,item=>(item.description||item.category||item.kind||'Money record')+' — '+money(item.amount)):'';
   return {answer:dateFmt(date)+' money summary:\nExpenses: '+money(expenses)+'\nIncome: '+money(income)+details,sources:['Money & Udhaar']};
  }
  const list=searchRows.length?searchRows:rows.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,8);
  return {answer:list.length?'Money records:\n'+describe(list,item=>(item.description||item.category||item.kind||'Money record')+' — '+money(item.amount)+' · '+(item.date?dateFmt(item.date):'No date')+(item.person?' · '+item.person:'')):'Mujhe iske baare mein kuch nahi mila, aap Tasks, Notes, Projects, Routines ya Money try kar sakte ho.',sources:['Money & Udhaar']};
 }
 return {answer:'Mujhe iske baare mein kuch nahi mila, aap Tasks, Notes, Projects, Routines ya Money try kar sakte ho.',sources:[]};
}

function aiAnswer(question){
 const raw=String(question||''),terms=aiQueryTerms(raw);
 if(/^\s*(?:search|find|look for|locate)\b/i.test(raw)||(/\bwhere is\b/i.test(raw)&&/\b(?:my|workspace|one|task|note|memory|project|file|document|expense|record)\b/i.test(raw)))return phase4SearchWorkspace(raw);
 if(/\b(?:what should i do|plan my day|plan today|daily plan|prioriti[sz]e my tasks|suggest.*(?:priority|plan)|aaj kya karu)\b/i.test(raw))return phase4DailyPlan();
 if(/\b(?:spending pattern|spending insight|spending trend|category breakdown|compare.*(?:spend|expense)|budget insight|where.*money go|kharcha.*(?:compare|pattern))\b/i.test(raw))return phase4SpendingInsights();
 if(/\b(?:project risk|projects at risk|which project.*(?:risk|delay)|project.*behind|risk check)\b/i.test(raw))return phase4ProjectRisks();
 if(/\b(spend|spent|expense|expenses|money|rupees?|rs\.?|kharch|udhaar|lent|borrowed|owe|repaid|kitna|diye|diya)\b/i.test(raw)){
  const expenses=data.expenses||[],fmt=n=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
  const person=extractMoneyPerson(raw);
  if(person&&/\b(kitna|how much|rupees?|rs\.?|diye|diya|lent|gave|paid)\b/i.test(raw)){
   const matches=expenses.filter(e=>String(e.person||'').toLowerCase()===person.toLowerCase()&&['lent','lent_repayment'].includes(e.kind));
   const given=matches.filter(e=>e.kind==='lent').reduce((n,e)=>n+Number(e.amount||0),0),returned=matches.filter(e=>e.kind==='lent_repayment').reduce((n,e)=>n+Number(e.amount||0),0),balance=given-returned;
   const answer=matches.length?'You gave '+person+' '+fmt(given)+'.'+(returned?' They returned '+fmt(returned)+', so '+fmt(balance)+' is still due.':'')+' '+matches.filter(e=>e.kind==='lent').map(e=>'Record: '+fmt(e.amount)+' on '+dateFmt(e.date)+(e.dueDate?' · due '+dateFmt(e.dueDate):'')).join('; '):'I could not find a saved lending record for '+person+'. No matching money record exists in Money & Udhaar yet.';
   return {answer,sources:['Money & Udhaar']};
  }
  const total=expenses.filter(e=>(e.kind||'expense')==='expense').reduce((sum,e)=>sum+Number(e.amount||0),0);
  const lent=expenses.filter(e=>e.kind==='lent').reduce((sum,e)=>sum+Number(e.amount||0),0)-expenses.filter(e=>e.kind==='lent_repayment').reduce((sum,e)=>sum+Number(e.amount||0),0);
  const borrowed=expenses.filter(e=>e.kind==='borrowed').reduce((sum,e)=>sum+Number(e.amount||0),0)-expenses.filter(e=>e.kind==='borrowed_repayment').reduce((sum,e)=>sum+Number(e.amount||0),0);
  return {answer:'Saved records show expenses of '+fmt(total)+', people owe you '+fmt(lent)+', and you owe others '+fmt(borrowed)+'. These totals use your saved Money & Udhaar records.',sources:['Money & Udhaar']};
 }
 if(/\b(task|tasks|todo|to-do|pending|overdue|deadline|planner)\b/i.test(raw)){
  const tasks=(data.tasks||[]).filter(t=>!t.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  return {answer:tasks.length?'Your pending tasks:\n'+tasks.slice(0,15).map((t,i)=>(i+1)+'. '+t.title+' — '+(t.due?(t.due<today()?'OVERDUE · ':'Due ')+dateFmt(t.due):'No due date')+' · '+(t.priority||'Medium')).join('\n'):'You have no pending tasks saved right now.',sources:['Tasks & Planner']};
 }
 const retrieval=aiBuildDocumentEvidence(data.documents||[],raw,null,{maxDocs:6,maxChunks:12,maxChars:18000});
 const hits=retrieval.evidence.map(hit=>({text:hit.text,score:hit.score,source:hit.label}));
 (data.notes||[]).forEach(note=>{const text=[note.title,note.subject,note.tags,note.content].filter(Boolean).join(' '),score=aiTextScore(text,terms);if(score>0)hits.push({text,score,source:'Note: '+(note.title||'Untitled note')})});
 (data.memories||[]).forEach(memory=>{const text=[memory.title,memory.category,memory.content].filter(Boolean).join(' '),score=aiTextScore(text,terms);if(score>0)hits.push({text,score,source:'Personal memory: '+(memory.title||'Memory')})});
 hits.sort((a,b)=>b.score-a.score);
 const selected=hits.slice(0,5);
 const answer=selected.map((hit,index)=>(index+1)+'. '+hit.text).join('\n\n');const completeness=knowledgeAnswerCompleteness(answer,raw);return selected.length?{answer:answer+(completeness.complete?'':'\n\nI could not verify the '+completeness.missing.join(' and ')+'. Open the source extract to check the original page.'),sources:[...new Set(selected.map(hit=>hit.source))]}:{answer:'I could not find matching saved content. Try mentioning a course name, keyword, or phrase from your file. When AI is connected, Brain can explain the relevant content in natural language.',sources:[]};
}
function fmtMoney(amount){return '₹'+Number(amount).toLocaleString('en-IN',{maximumFractionDigits:2})}
async function chatActionIntent(question){
 const raw=String(question||'').trim(),lower=raw.toLowerCase();
 const syncResult=async()=>{if(!cloudReady||!cloudUser)return ' Saved on this device; sign in to sync across devices.';if(!navigator.onLine)return ' Saved locally; cloud sync is queued until the device is online.';await syncQueue;return cloudMode==='synced'?' Saved and synced to your account.':' Saved locally, but cloud sync is not confirmed yet. Check the cloud status before relying on another device.'};
 const verify=(key,record)=>{try{const disk=JSON.parse(localStorage.getItem(workspaceStorageKey())||'{}');return Array.isArray(disk[key])&&disk[key].some(x=>x.id===record.id)}catch{return false}};
 if(pendingChatAction){
  const pending=pendingChatAction;
  if(pending.requestedAt&&Date.now()-pending.requestedAt>5*60*1000){pendingChatAction=null;return {answer:'That confirmation expired after 5 minutes. No data was changed. Please send the request again.',sources:[pending.source||'Ask One']};}
  if(/^(?:yes|yes confirm|confirm|confirm delete|haan|ha|kar do|delete it|proceed)$/i.test(lower)){
   pendingChatAction=null;
   if(pending.type==='create-record'){
    const allowed={tasks:'Planner',notes:'Notes & Memory',projects:'Projects',expenses:'Money & Udhaar'};
    if(!allowed[pending.collection]||!pending.record)return {answer:'This action is no longer valid. No data was changed.',sources:[]};
    const list=data[pending.collection]=Array.isArray(data[pending.collection])?data[pending.collection]:[];
    const record=pending.record;
    const duplicate=list.find(item=>{
     if(pending.collection==='tasks')return !item.done&&!record.done&&String(item.title||'').trim().toLowerCase()===String(record.title||'').trim().toLowerCase()&&String(item.due||'')===String(record.due||'');
     if(pending.collection==='notes')return String(item.content||'').trim().toLowerCase()===String(record.content||'').trim().toLowerCase()&&Date.now()-Number(item.created||0)<24*60*60*1000;
     if(pending.collection==='projects')return String(item.name||item.title||'').trim().toLowerCase()===String(record.name||record.title||'').trim().toLowerCase();
     return (item.kind||'expense')===(record.kind||'expense')&&Number(item.amount)===Number(record.amount)&&String(item.description||'').trim().toLowerCase()===String(record.description||'').trim().toLowerCase()&&String(item.date||'')===String(record.date||'')&&String(item.person||'').trim().toLowerCase()===String(record.person||'').trim().toLowerCase();
    });
    if(duplicate)return {answer:'A matching record was added while this confirmation was waiting. I did not create another copy.',sources:[pending.source||allowed[pending.collection]]};
    list.push(record);persist();
    if(!verify(pending.collection,record)){data[pending.collection]=list.filter(item=>item.id!==record.id);persist();return {answer:'Save verification failed. I did not mark this action as successful; please check the relevant section.',sources:[]};}
    if(pending.page)page=pending.page;
    if(pending.moneyTab)window.moneyTab=pending.moneyTab;
    if(pending.expenseMonth)window.expenseMonth=pending.expenseMonth;
    const sync=await syncResult();render();
    return {answer:(pending.successMessage||'Record created and verified.')+sync,sources:[pending.source||allowed[pending.collection]]};
   }
   if(pending.type==='update-record'){
    const collection={task:'tasks',note:'notes',project:'projects'}[pending.recordType],record=(data[collection]||[]).find(item=>item.id===pending.id);
    if(!record)return {answer:'Record ab nahi mila. Kuch update nahi kiya.',sources:[pending.source]};
    Object.assign(record,pending.patch,{updated:Date.now()});persist();
    const saved=verify(collection,record);
    if(!saved)return {answer:'Update verify nahi hua. Koi success confirmation nahi de raha; record manually check karo.',sources:[pending.source]};
    const sync=await syncResult();page=pending.recordType==='task'?'planner':pending.recordType==='note'?'notes':'projects';render();
    return {answer:'Updated '+pending.recordType+': "'+pending.title+'". '+Object.keys(pending.patch).join(', ')+' changed.'+sync,sources:[pending.source]};
   }
   if(pending.type==='delete-task'){
    const target=(data.tasks||[]).find(task=>task.id===pending.id);
    if(!target)return {answer:'Task ab nahi mila. Kuch delete nahi kiya.',sources:['Planner']};
    data.tasks=data.tasks.filter(task=>task.id!==pending.id);persist();
    const verified=!(data.tasks||[]).some(task=>task.id===pending.id);
    if(!verified)return {answer:'Delete verify nahi hua. Planner mein record check karo.',sources:['Planner']};
    page='planner';const sync=await syncResult();render();
    return {answer:'Confirmed: task "'+pending.title+'" deleted from Planner.'+sync,sources:['Planner']};
   }
  }
  if(/^(?:no|no cancel|cancel|nahi|mat karo|stop)$/i.test(lower)){
   pendingChatAction=null;
   return {answer:'The action was cancelled. No data was changed.',sources:['Planner']};
  }
  pendingChatAction=null;
 }

 const rememberMatch=raw.match(/^\s*(?:please\s+)?(?:remember(?:\s+that|\s+this)?|save to memory|yaad rakhna|ise yaad rakhna)\s*[:,-]?\s*(.+)$/i);
 if(rememberMatch){
  const content=rememberMatch[1].trim();
  if(/\b(password|passcode|otp|one[- ]time password|api key|secret key|private key|upi pin|pin number|cvv|card number)\b/i.test(content))return {answer:'For your safety, One will not save passwords, OTPs, PINs, API keys or payment credentials in Personal Memory.',sources:['Personal Memory']};
  if(content.length<3)return {answer:'Kya yaad rakhna hai? Ek short fact ya preference likho.',sources:['Personal Memory']};
  data.memories=Array.isArray(data.memories)?data.memories:[];
  const duplicate=data.memories.find(m=>String(m.content||'').trim().toLowerCase()===content.toLowerCase());
  if(duplicate)return {answer:'Yeh baat pehle se Personal Memory mein saved hai: '+(duplicate.title||content)+'. Duplicate nahi banaya.',sources:['Personal Memory']};
  const title=content.split(/[.!?]/)[0].slice(0,72)||'Remembered detail';
  const memory={id:uid(),title,category:'Remembered',content,date:today(),created:Date.now(),updated:Date.now()};
  data.memories.push(memory);persist();
  const diskVerified=(()=>{try{return JSON.parse(localStorage.getItem(workspaceStorageKey())||'{}').memories?.some(m=>m.id===memory.id)}catch{return false}})();
  if(!diskVerified){data.memories=data.memories.filter(m=>m.id!==memory.id);return {answer:'Memory save verify nahi hua. Kuch saved claim nahi kar raha.',sources:[]}}
  const sync=await syncResult();page='memory';render();
  return {answer:'Saved to Personal Memory: '+content+'. You can review or delete it anytime in Personal Memory.'+sync,sources:['Personal Memory']};
 }
 const parseDate=()=>{
  const addDays=n=>{const [y,m,d]=today().split('-').map(Number),date=new Date(y,m-1,d+n,12,0,0);return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')};
  if(/\b(?:tomorrow|kal|next day|कल)\b/i.test(lower))return addDays(1);
  if(/\b(?:today|aaj|abhi|आज)\b/i.test(lower))return today();
  const relative=lower.match(/\b(?:in|after)\s+(\d{1,2})\s+days?\b|\b(\d{1,2})\s+din\s+(?:baad|mein)\b/i);
  if(relative)return addDays(Number(relative[1]||relative[2]));
  if(/\bnext week\b|\bagle hafte\b/i.test(lower))return addDays(7);
  const numeric=raw.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if(numeric){const day=Number(numeric[1]),month=Number(numeric[2])-1,year=Number(numeric[3]?(numeric[3].length===2?'20'+numeric[3]:numeric[3]):new Date().getFullYear()),d=new Date(year,month,day);if(d.getFullYear()===year&&d.getMonth()===month&&d.getDate()===day)return year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0')}

  const m=raw.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/i);
  if(!m)return '';
  const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11},month=months[m[2].slice(0,3).toLowerCase()],year=Number(m[3]||new Date().getFullYear()),day=Number(m[1]),d=new Date(year,month,day);
  return d.getFullYear()===year&&d.getMonth()===month&&d.getDate()===day?year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'):'';
 };
 const fieldDateForMoney=()=>{if(/\b(?:yesterday|kal\s+tha|beete\s+kal)\b/i.test(lower)){const d=new Date();d.setDate(d.getDate()-1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}return parseDate()||today()};
 const dateKeyword=/\b(?:today|today'?s|this\s+day|current\s+day|aaj|aaj\s+ka|aaj\s+ki|aaj\s+ke|tomorrow|kal|kal\s+ka|kal\s+ki|kal\s+ke|yesterday|kal\s+tha|beete\s+kal|parso|parson|day\s+after\s+tomorrow|next\s+day|आज|आज\s+का|आज\s+की|आज\s+के|कल|कल\s+का|कल\s+की|कल\s+के|परसों)\b|\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b|\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(lower);
 const dateQueryIntent=dateKeyword&&(/\b(?:task|tasks|todo|to-do|kaam|assignment|planner|money|expense|expenses|spending|kharcha|kharch|income|payment|udhaar|lent|borrowed|repayment|transaction|transactions|schedule|plan|kya|what|show|dikhao|batao|bata|hai|hain|list|details|activity|records?)\b/i.test(lower)||/^\s*(?:today|aaj|kal|tomorrow|yesterday|parso|parson|आज|कल|परसों)\s*[?.!]*$/i.test(lower));
 if(!pendingChatAction&&dateQueryIntent){
  let selectedDate=parseDate();
  if(/\b(?:yesterday|kal\s+tha|beete\s+kal|day\s+before\s+yesterday)\b/i.test(lower)){const d=new Date(today()+'T12:00:00');d.setDate(d.getDate()-(/\bday\s+before\s+yesterday\b/i.test(lower)?2:1));selectedDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  else if(/\b(?:parso|parson|day\s+after\s+tomorrow|परसों)\b/i.test(lower)){const d=new Date(today()+'T12:00:00');d.setDate(d.getDate()+2);selectedDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  selectedDate=selectedDate||today();
  const dayTasks=(data.tasks||[]).filter(t=>t.due===selectedDate);
  const dayMoney=(data.expenses||[]).filter(e=>e.date===selectedDate||e.dueDate===selectedDate);
  const dayLabel=dateFmt(selectedDate);
  const taskLines=dayTasks.length?dayTasks.map(t=>(t.done?'✓ ':'• ')+String(t.title||'Untitled task')+' — '+(t.done?'Completed':'Pending')+(t.category?' · '+t.category:'')).join('\n'):'No tasks scheduled.';
  const moneyLines=dayMoney.length?dayMoney.map(e=>{const kind=e.kind||'expense',label=({expense:'Expense',income:'Income',lent:'Money lent',borrowed:'Money borrowed',lent_repayment:'Repayment received',borrowed_repayment:'Repayment paid'})[kind]||'Money';return '• '+String(e.description||label)+' — '+fmtMoney(e.amount)+' · '+label+(e.dueDate===selectedDate&&e.date!==selectedDate?' · Due today':'')}).join('\n'):'No money activity.';
  const wantsTask=/\b(?:task|tasks|todo|to-do|kaam|assignment|planner)\b/i.test(lower),wantsMoney=/\b(?:money|expense|expenses|spending|kharcha|kharch|income|payment|udhaar|lent|borrowed|repayment|transaction|transactions)\b/i.test(lower);
  const parts=[];
  if(!wantsMoney||wantsTask)parts.push('TASKS ('+dayTasks.length+')\n'+taskLines);
  if(!wantsTask||wantsMoney)parts.push('MONEY ('+dayMoney.length+')\n'+moneyLines);
  return {answer:dayLabel+'\n\n'+parts.join('\n\n'),sources:['Daily Planner','Money & Udhaar']};
 }
 // Deterministic command routing: reminder/briefing requests must be handled
 // locally before document Q&A, while explicit "add task" remains a Planner task.
 const explicitTaskAddIntent=/\b(?:add|create|make)\s+(?:a\s+)?(?:new\s+)?(?:task|todo)\b|\b(?:task|todo)\s+(?:add|bana|create|make)\b|\b(?:task|todo)\s+mein\s+add\s+kar(?:o|na|\s+do)?\b|\b(?:task\s+bana\s+do|task\s+create\s+karo|task\s+add\s+kar\s+do|todo\s+bana\s+do)\b/i.test(lower);
 const reminderCommandIntent=/\b(?:remind\s+me|reminder|yaad\s+(?:dila(?:na|\s+dena|\s+do)?|rakhna)|mat\s+bhoolna|don't\s+let\s+me\s+forget|briefing|brief\s+me|bata\s+dena|batana|yaad\s+karwana)\b/i.test(lower);
 if(!pendingChatAction&&explicitTaskAddIntent&&!reminderCommandIntent){
  const due=parseDate();
  const timeMatch=raw.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)\b/i),clockMatch=raw.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  let reminderTime=/\b(?:shaam|sham|evening|raat|night)\b/i.test(lower)?'19:00':'09:00';
  if(clockMatch)reminderTime=String(Number(clockMatch[1])).padStart(2,'0')+':'+clockMatch[2];
  else if(timeMatch){let h=Number(timeMatch[1]),m=Number(timeMatch[2]||0),mer=timeMatch[3].toLowerCase();if(h<1||h>12||m>59)return {answer:'Time valid nahi hai. Example: 9 am ya 7:30 pm.',sources:['Planner']};if(mer==='pm'&&h<12)h+=12;if(mer==='am'&&h===12)h=0;reminderTime=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')}
  const title=raw.replace(/^\s*(?:please\s+)?/i,'').replace(/\b(?:add|create|make|new|a|an|task|todo|mein|me|add|kar|karo|karna|do|due|on|by|today|tomorrow|kal|aaj|subah|morning|shaam|sham|evening|raat|night|at|baje|am|pm)\b/ig,' ').replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?\b/ig,' ').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title)return {answer:'Task ka naam batao. Example: Add task assignment due tomorrow.',sources:['Planner']};
  const duplicate=(data.tasks||[]).find(x=>!x.done&&String(x.title||'').toLowerCase()===title.toLowerCase()&&String(x.due||'')===(due||''));
  if(duplicate)return {answer:'Ye task pehle se Planner mein hai. Duplicate nahi banaya.',sources:['Planner']};
  const task={id:uid(),title,category:/assignment|homework/i.test(lower)?'Assignment':/exam/i.test(lower)?'Exam':/project/i.test(lower)?'Project':'Personal',due,reminderTime,priority:'Medium',done:false,created:Date.now(),updated:Date.now()};
  pendingChatAction={type:'create-record',collection:'tasks',record:task,source:'Planner',page:'planner',successMessage:'Task saved in Planner: '+title+'.',requestedAt:Date.now()};
  return {answer:'Confirm Task Add: '+title+(due?' · '+dateFmt(due):'')+'. Reply YES to save or NO to cancel. Abhi save nahi hua.',sources:['Planner']};
 }
 if(!pendingChatAction&&reminderCommandIntent){
  const daily=/\b(?:daily|every\s+day|roz|har\s+roz|har\s+din)\b/i.test(lower);
  const due=daily?today():parseDate();
  if(!due)return {answer:'Reminder/briefing ki date batao. Example: Kal subah assignment likhna yaad dilana, ya roz subah 9 baje project update batana.',sources:['Task Briefing','Planner']};
  const timeMatch=raw.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)\b/i),clockMatch=raw.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  let reminderTime=/\b(?:shaam|sham|evening|raat|night)\b/i.test(lower)?'19:00':'09:00';
  if(clockMatch)reminderTime=String(Number(clockMatch[1])).padStart(2,'0')+':'+clockMatch[2];
  else if(timeMatch){let h=Number(timeMatch[1]),m=Number(timeMatch[2]||0),mer=timeMatch[3].toLowerCase();if(h<1||h>12||m>59)return {answer:'Time valid nahi hai. Example: 9 am ya 7:30 pm.',sources:['Task Briefing']};if(mer==='pm'&&h<12)h+=12;if(mer==='am'&&h===12)h=0;reminderTime=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')}
  const title=raw.replace(/^\s*(?:please\s+)?/i,'').replace(/\b(?:mujhe|mere|ko|roz|daily|every\s+day|har\s+roz|har\s+din|subah|morning|shaam|sham|evening|raat|night|briefing|brief\s+me|remind\s+me|reminder|yaad|dila(?:na|\s+dena|\s+do)?|bata\s+dena|batana|mat\s+bhoolna|don't\s+let\s+me\s+forget|please|on|at|by|around|baje|am|pm|today|tomorrow|kal|aaj|next\s+week|agle\s+hafte)\b/ig,' ').replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?\b/ig,' ').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title)return {answer:'Kis cheez ka reminder chahiye? Example: Kal subah assignment likhna yaad dilana.',sources:['Task Briefing']};
  const duplicate=(data.tasks||[]).find(x=>!x.done&&x.category==='Briefing'&&String(x.title||'').toLowerCase()===title.toLowerCase()&&String(x.due||'')===due&&(x.repeatRule||'none')===(daily?'daily':'none'));
  if(duplicate)return {answer:'Ye briefing pehle se scheduled hai. Duplicate nahi banaya.',sources:['Task Briefing']};
  const task={id:uid(),title,category:'Briefing',due,reminderTime,repeatRule:daily?'daily':'none',priority:'Medium',done:false,created:Date.now(),updated:Date.now(),notes:'Created through Ask One reminder/briefing command.'};
  pendingChatAction={type:'create-record',collection:'tasks',record:task,source:'Task Briefing',page:'overview',successMessage:(daily?'Daily briefing':'Reminder')+' saved: '+title+' · '+(daily?'every day':dateFmt(due))+' at '+reminderTime+'.',requestedAt:Date.now()};
  return {answer:'Confirm '+(daily?'daily briefing':'reminder')+': '+title+' · '+(daily?'Every day':dateFmt(due))+' at '+reminderTime+'. Reply YES to save or NO to cancel. Ye Home ke Task Briefing mein dikhega.',sources:['Task Briefing','Planner']};
 }

 const moneyAmountMatch=raw.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?:\s*(?:rupees?|rs\.?|रुपये|रुपए))?/i);
 const moneyAddIntent=!!moneyAmountMatch&&/\b(?:add|save|record|note|write|likh|jod|karo|kar\s+do|diye|diya|gave|lend|lent|udhaar)\b/i.test(lower)&&/\b(?:ko|to)\s+[a-z][a-z'-]*/i.test(lower)&&/\b(?:diye|diya|gave|lend|lent|udhaar)\b/i.test(lower);
 if(moneyAddIntent){
  const amount=Number(moneyAmountMatch[1].replace(/,/g,'')),person=extractMoneyPerson(raw),dateMatches=[...raw.matchAll(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/ig)];
  const monthMap={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  const parsedDate=m=>{if(!m)return '';const month=monthMap[m[2].slice(0,3).toLowerCase()],year=Number(m[3]||new Date().getFullYear()),day=Number(m[1]),d=new Date(year,month,day);return d.getFullYear()===year&&d.getMonth()===month&&d.getDate()===day?year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0'):''};
  const transactionDate=parsedDate(dateMatches[0])||today(),dueDate=parsedDate(dateMatches[1])||'';
  if(!person||!Number.isFinite(amount)||amount<=0)return {answer:'Person aur valid amount clear nahi hua, isliye kuch save nahi kiya. Example: Arbaj ko ₹10 diye 10 Nov ko, 15 Nov ko wapas lene hain.',sources:['Money & Udhaar']};
  const duplicate=(data.expenses||[]).find(e=>e.kind==='lent'&&String(e.person||'').toLowerCase()===person.toLowerCase()&&Number(e.amount)===amount&&e.date===transactionDate&&String(e.dueDate||'')===dueDate);
  if(duplicate)return {answer:'Yeh record pehle se saved hai: '+fmtMoney(amount)+' lent to '+person+'. Duplicate nahi banaya.',sources:['Money & Udhaar']};
  const record={id:uid(),description:'Lent to '+person,person,amount:String(amount),category:'Udhaar',date:transactionDate,dueDate,kind:'lent',updated:Date.now(),created:Date.now()};
  pendingChatAction={type:'create-record',collection:'expenses',record,source:'Money & Udhaar',page:'expenses',moneyTab:'udhaar',expenseMonth:transactionDate.slice(0,7),successMessage:'Money & Udhaar mein saved: '+fmtMoney(amount)+' '+person+' ko diye'+(dueDate?' · wapas lene ki date '+dateFmt(dueDate):'')+'. Record verify kar liya hai.',requestedAt:Date.now()};
  return {answer:'Please confirm this money record: '+fmtMoney(amount)+' '+person+' ko diye'+(dueDate?' · wapas lene ki date '+dateFmt(dueDate):'')+'. Reply YES to save or NO to cancel. Abhi koi record add nahi hua.',sources:['Money & Udhaar']};
 }
 const noteReminderIntent=/\\b(?:is|iss|us|uss|ye|this|that)\\s+(?:note|notes)\\s+(?:ka|ki|ke)?\\s*(?:reminder|yaad)\\b|\\b(?:is|iss|us|uss|iska|uska|in notes? ka|note ka|note ki)\\s+(?:reminder|yaad|laga do|set karo|set kar do)\\b|\\b(?:remind me|yaad dilana|yaad dila do)\\s+(?:about|for|from)\\s+(?:my\\s+)?notes?\\b/i.test(lower);
 if(noteReminderIntent){
  const notes=Array.isArray(data.notes)?data.notes:[];
  if(!notes.length)return {answer:'Notes mein abhi koi saved note nahi mila. Pehle note save karo, phir uska reminder set kar denge.',sources:['Notes & Memory']};
  const query=lower.replace(/\\b(?:please|remind me|set (?:a )?reminder|reminder|yaad dilana|yaad dila do|is|iss|us|uss|ye|this|that|iska|uska|note|notes|ka|ki|ke|ko|for|about|from|my|kal|tomorrow|today|aaj|next week|agle hafte|shaam|sham|evening|raat|night|subah|morning|at|baje|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|baje)?)/gi,' ').replace(/\\s+/g,' ').trim();
  const words=query.split(/[^a-z0-9]+/i).filter(w=>w.length>2);
  const ranked=notes.map(note=>{const hay=[note.title,note.subject,note.tags,note.content].join(' ').toLowerCase();return {note,score:words.reduce((n,w)=>n+(hay.includes(w)?1:0),0)}}).sort((a,b)=>b.score-a.score||Number(b.note.updated||b.note.created||0)-Number(a.note.updated||a.note.created||0));
  let selected=ranked[0];
  if(words.length&&selected.score===0)selected=null;
  if(!selected&&words.length)return {answer:'Kaunsa saved note? Note ka title ya 2–3 keywords bhejo, main usi ka reminder bana dunga.',sources:['Notes & Memory']};
  if(selected&&ranked.length>1&&selected.score===ranked[1].score&&selected.score>0)return {answer:'Mujhe ek se zyada matching notes mile. Exact note title bata do: '+ranked.filter(x=>x.score===selected.score).slice(0,4).map(x=>'“'+(x.note.title||'Untitled note')+'”').join(', ')+'.',sources:['Notes & Memory']};
  if(!selected)selected=notes.slice().sort((a,b)=>Number(b.updated||b.created||0)-Number(a.updated||a.created||0))[0];
  const due=parseDate();
  if(!due)return {answer:'Saved note “'+(selected.title||'Untitled note')+'” mil gaya. Kis date ko reminder chahiye? Example: Kal 7 baje.',sources:['Notes & Memory','Planner']};
  const timeMatch=raw.match(/\\b(?:at\\s+(\\d{1,2})(?::(\\d{2}))?(?:\\s*(am|pm|baje))?|(?:(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|baje)))\\b/i);
  const clockMatch=raw.match(/\\b(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)\\b/i);
  let reminderTime='';
  if(clockMatch)reminderTime=String(Number(clockMatch[1])).padStart(2,'0')+':'+clockMatch[2];
  else if(timeMatch){let hour=Number(timeMatch[1]||timeMatch[4]),minute=Number(timeMatch[2]||timeMatch[5]||0),meridiem=(timeMatch[3]||timeMatch[6]||'').toLowerCase();if(hour>23||hour<1||minute>59||(meridiem&&hour>12))return {answer:'Reminder time valid nahi hai. Example: 7:30 pm ya 19:30.',sources:['Planner']};if(meridiem==='pm'&&hour<12)hour+=12;if(meridiem==='am'&&hour===12)hour=0;if(!meridiem&&/\\b(?:shaam|sham|evening|raat|night)\\b/i.test(lower)&&hour<12)hour+=12;reminderTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')}
  if(!reminderTime)return {answer:'Saved note “'+(selected.title||'Untitled note')+'” ke liye time bhi batao. Example: Kal shaam 7 baje.',sources:['Notes & Memory','Planner']};
  const title='Review note: '+(selected.title||String(selected.content||'Saved note').slice(0,70));
  const duplicate=(data.tasks||[]).find(t=>!t.done&&String(t.title||'').toLowerCase()===title.toLowerCase()&&t.due===due&&t.reminderTime===reminderTime);
  if(duplicate)return {answer:'Is note ka reminder pehle se set hai: “'+(selected.title||'Untitled note')+'” · '+dateFmt(due)+' at '+reminderTime+'. Duplicate nahi banaya.',sources:['Planner','Notes & Memory']};
  const task={id:uid(),title,category:'Reminder',notes:'Related saved note ID: '+selected.id+'\\n'+String(selected.content||'').slice(0,1200),relatedNoteId:selected.id,due,reminderTime,priority:'Medium',done:false,created:Date.now(),updated:Date.now()};
  pendingChatAction={type:'create-record',collection:'tasks',record:task,source:'Notes & Memory',page:'planner',successMessage:'Saved note “'+(selected.title||'Untitled note')+'” ka reminder set ho gaya: '+dateFmt(due)+' at '+reminderTime+'.',requestedAt:Date.now()};
  return {answer:'Confirm reminder for your existing note “'+(selected.title||'Untitled note')+'” · '+dateFmt(due)+' at '+reminderTime+'. Reply YES to save or NO to cancel. Main naya note nahi bana raha.',sources:['Notes & Memory','Planner']};
 }
 const briefingIntent=/\b(?:brief me|briefing|roz|daily|every day|har roz|har din|is date ko|iss date ko|us date ko|batana|bata dena)\b/i.test(lower)&&/\b(?:bata|batana|bata dena|remind|yaad|brief|briefing|update)\b/i.test(lower);
 if(briefingIntent){
  const daily=/\b(?:roz|daily|every day|har roz|har din|रोज़|रोज)\b/i.test(lower);
  let due=daily?today():parseDate();
  if(!daily&&!due){const dayOnly=lower.match(/\b(\d{1,2})\s*(?:tarikh|tareekh|तारीख)\b/i);if(dayOnly){const n=Number(dayOnly[1]);if(n>=1&&n<=31){const [yy,mm]=today().split('-').map(Number);let d=new Date(yy,mm-1,n);if(d.getDate()===n&&d.toISOString().slice(0,10)<today())d=new Date(yy,mm,n);if(d.getDate()===n)due=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}}}
  if(!due)return {answer:'Kis date ko briefing chahiye? Example: 20 November ko mujhe project update batana, ya roz subah 9 baje batana.',sources:['Planner','Ask One']};
  const timeMatch=raw.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)\b/i),clockMatch=raw.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  let reminderTime='09:00';
  if(clockMatch)reminderTime=String(Number(clockMatch[1])).padStart(2,'0')+':'+clockMatch[2];
  else if(timeMatch){let hour=Number(timeMatch[1]),minute=Number(timeMatch[2]||0),meridiem=(timeMatch[3]||'').toLowerCase();if(hour<1||hour>12||minute>59)return {answer:'Time valid nahi hai. Example: 9 am ya 7:30 pm.',sources:['Planner']};if(meridiem==='pm'&&hour<12)hour+=12;if(meridiem==='am'&&hour===12)hour=0;reminderTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')}
  const title=raw.replace(/^\s*(?:please\s+)?/i,'').replace(/\b(?:mujhe|mere|ko|roz|daily|every day|har roz|har din|subah|morning|shaam|sham|evening|raat|night|is date ko|iss date ko|us date ko|date ko|on|at|bata dena|batana|batao|remind me|yaad dilana|yaad dila dena|brief me|briefing|brief|update|please|around|baje|am|pm)\b/ig,' ').replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?\b/ig,' ').replace(/\b(?:today|tomorrow|kal|aaj|next week|agle hafte|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/ig,' ').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title)return {answer:'Kis cheez ke baare mein batana hai? Example: Roz subah 9 baje project updates batana.',sources:['Ask One','Planner']};
  const duplicate=(data.tasks||[]).find(t=>!t.done&&t.category==='Briefing'&&String(t.title||'').toLowerCase()===title.toLowerCase()&&t.due===due&&(t.repeatRule||'none')===(daily?'daily':'none'));
  if(duplicate)return {answer:'Ye briefing pehle se scheduled hai: '+title+'. Duplicate nahi banaya.',sources:['Planner']};
  const task={id:uid(),title,category:'Briefing',due,reminderTime,repeatRule:daily?'daily':'none',priority:'Medium',done:false,notes:'Created through Ask One voice/text briefing instruction.',created:Date.now(),updated:Date.now()};
  pendingChatAction={type:'create-record',collection:'tasks',record:task,source:'Task briefing',page:'overview',successMessage:(daily?'Daily briefing':'Scheduled briefing')+' saved: '+title+' · '+(daily?'every day':dateFmt(due))+' at '+reminderTime+'. Enable notifications for alerts.',requestedAt:Date.now()};
  return {answer:'Confirm '+(daily?'daily':'one-time')+' briefing: '+title+' · '+(daily?'Every day':dateFmt(due))+' at '+reminderTime+'. Reply YES to save or NO to cancel.',sources:['Task briefing','Planner']};
 }
 const explicitTaskAdd=/\\b(?:add|create|make)\\s+(?:a\\s+)?(?:new\\s+)?(?:task|todo)\\b|\\b(?:task|todo)\\s+(?:add|bana|create|make)\\b|\\b(?:task|todo)\\s+(?:mein|me)\\s+(?:add|jod)\\s+(?:kar|karo|kar do)\\b|\\b(?:task bana do|task create karo|task add kar do|todo bana do)\\b/i.test(lower);
 const naturalReminder=/\\b(?:yaad\\s+(?:dila|dilana|dila dena|dila do|dila dijiyega|dilaa dena)|remind\\s+me|reminder\\s+(?:laga|set)|mat\\s+bhoolna|bhoolna\\s+mat|yaad\\s+rakhna|remind\\s+karna)\\b/i.test(lower);
 const reminderIntent=!explicitTaskAdd&&naturalReminder||/\\b(?:remind me(?: to| about)?|set (?:a )?reminder|reminder (?:for|laga do|set karo|set kar do)|reminder laga do)\\b/i.test(lower);
 if(reminderIntent){
  const due=parseDate();
  if(!due)return {answer:'Reminder ki date batao. Example: Remind me to pay electricity bill tomorrow at 7 pm.',sources:['Planner']};
  const timeMatch=raw.match(/\b(?:at\s+(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|baje))?|(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)))\b/i);
  const clockMatch=raw.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  let reminderTime=/\\b(?:shaam|sham|evening|raat|night)\\b/i.test(lower)?'19:00':'09:00';
  if(clockMatch){reminderTime=String(Number(clockMatch[1])).padStart(2,'0')+':'+clockMatch[2]}
  else if(timeMatch){let hour=Number(timeMatch[1]||timeMatch[4]),minute=Number(timeMatch[2]||timeMatch[5]||0),meridiem=(timeMatch[3]||timeMatch[6]||'').toLowerCase();if(hour>23||hour<1||minute>59||(meridiem&&hour>12))return {answer:'Reminder time valid nahi hai. Example: 7:30 pm ya 19:30.',sources:['Planner']};if(meridiem==='pm'&&hour<12)hour+=12;if(meridiem==='am'&&hour===12)hour=0;if(!meridiem&&/\b(?:shaam|sham|evening|raat|night)\b/i.test(lower)&&hour<12)hour+=12;reminderTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')}
  const title=raw.replace(/^\s*(?:please\s+)?(?:remind me(?: to| about)?|set (?:a )?reminder(?: for)?|reminder (?:for|laga do|set karo|set kar do)|yaad dilana|yaad dila dena|yaad dila do|mujhe yaad(?:\s+dilana|\s+dila dena|\s+dila do))\s*/i,'').replace(/\b(?:today|tomorrow|kal|aaj|next day|next week|agle hafte|in\s+\d+\s+days?|after\s+\d+\s+days?|\d+\s+din\s+(?:baad|mein)|shaam|sham|evening|raat|night|subah|morning)\b/ig,'').replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g,'').replace(/\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/ig,'').replace(/\b(?:at\s+)?(?:[01]?\d|2[0-3])(?::\d{2})?\s*(?:am|pm|baje)?\b/ig,'').replace(/\b(?:remind me|set a reminder|reminder|laga do|set karo|set kar do|yaad dilana|yaad dila dena|yaad dila do|mujhe|please|on|at|by)\b/ig,'').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title)return {answer:'Kis cheez ka reminder chahiye? Example: Remind me to call home tomorrow at 7 pm.',sources:['Planner']};
  const duplicate=(data.tasks||[]).find(t=>!t.done&&String(t.title||'').toLowerCase()===title.toLowerCase()&&t.due===due);
  if(duplicate)return {answer:'Reminder already exists for '+title+' on '+dateFmt(due)+'. Duplicate nahi banaya.',sources:['Planner']};
  const task={id:uid(),title,category:'Briefing',due,reminderTime,priority:'Medium',done:false,created:Date.now(),updated:Date.now(),notes:'Created from a natural-language Ask One reminder.'};
  pendingChatAction={type:'create-record',collection:'tasks',record:task,source:'Task briefing',page:'overview',successMessage:'Briefing saved: '+title+' · '+dateFmt(due)+' at '+reminderTime+'. Enable notifications in One to receive a browser alert when One is open or reopened.',requestedAt:Date.now()};
  return {answer:'Confirm Task Briefing: '+title+' · '+dateFmt(due)+' at '+reminderTime+'. Reply YES to save or NO to cancel. It will appear under Task Briefing on Home.',sources:['Task Briefing','Planner']};
 }
 const addTask=explicitTaskAdd&&!naturalReminder||!naturalReminder&&/\\b(?:schedule|bana do|banao|add kar|jod do|likh lo)\\b/i.test(lower)&&/\\b(?:task|todo|assignment|deadline|homework|exam|submit|kaam)\\b/i.test(lower);
 if(addTask){
  const noteMatch=raw.match(/\b(?:notes?|details?)\s*[:\-]\s*(.+)$/i),notes=noteMatch?noteMatch[1].trim():'';
  let title=raw.replace(/\b(?:notes?|details?)\s*[:\-]\s*.+$/i,'').replace(/\b(?:please|add|create|make|remind me to|remind me|schedule|bana do|banao|add kar do|add kar|jod do|likh lo|yaad dilana|a|an|the|task|todo|assignment|deadline|homework|exam|submit|kaam|due|today|tomorrow|kal|aaj|on|by)\b/ig,' ').replace(/\s+/g,' ').replace(/^[\s:,-]+|[\s:,-]+$/g,'').trim();
  if(!title)return {answer:'Task ka naam batao. Example: Add task DSA assignment due tomorrow. Notes: chapter 4 complete karna.',sources:['Planner']};
  const due=parseDate();
  const existing=(data.tasks||[]).find(item=>!item.done&&String(item.title||'').trim().toLowerCase()===title.toLowerCase()&&String(item.due||'')===due);
  if(existing)return {answer:'A matching open task already exists: "'+existing.title+'". I did not create a duplicate.',sources:['Planner']};
  const reminderTimeMatch=raw.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)\b/i);
  let reminderTime='09:00';
  if(reminderTimeMatch){let hour=Number(reminderTimeMatch[1]),minute=Number(reminderTimeMatch[2]||0),meridiem=(reminderTimeMatch[3]||'').toLowerCase();if(minute>59||hour>12||hour<0)return {answer:'Reminder time valid nahi hai. Example: 7:30 pm.',sources:['Planner']};if(meridiem==='pm'&&hour<12)hour+=12;if(meridiem==='am'&&hour===12)hour=0;if(meridiem==='baje'&&hour>23)return {answer:'Time 24-hour format mein do, jaise 19:00.',sources:['Planner']};reminderTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')}
  const task={id:uid(),title,category:/assignment|submit/i.test(lower)?'Assignment':/exam/i.test(lower)?'Exam':/project/i.test(lower)?'Project':'Personal',due,reminderTime,notes,priority:/urgent|important|high priority/i.test(lower)?'High':'Medium',done:false,created:Date.now(),updated:Date.now()};
  pendingChatAction={type:'create-record',collection:'tasks',record:task,source:'Planner',page:'planner',successMessage:'Task saved in Planner: '+title+(due?' · Due '+dateFmt(due):' · No due date')+(notes?' · Notes: '+notes:'')+'. Saved task verify kar liya.',requestedAt:Date.now()};
  return {answer:'Please confirm task: '+title+(due?' · Due '+dateFmt(due):' · No due date')+'. Reply YES to save or NO to cancel. Abhi task add nahi hua.',sources:['Planner']};
 }
 const addNote=/\b(?:add|save|create|write|likh|save kar)\b/i.test(lower)&&/\b(?:note|notes|notepad)\b/i.test(lower);
 if(addNote){
  const content=raw.replace(/^\s*(?:please\s+)?(?:add|save|create|write|likh(?:\s+do)?|save kar(?:\s+do)?)\s+(?:a\s+)?note\s*[:\-]?\s*/i,'').trim();
  if(!content)return {answer:'Note ka content bhi likho. Example: Save note: Kal project meeting hai.',sources:['Notes & Memory']};
  const duplicate=(data.notes||[]).find(item=>String(item.content||'').trim().toLowerCase()===content.toLowerCase()&&Date.now()-Number(item.created||0)<24*60*60*1000);
  if(duplicate)return {answer:'This exact note was already saved recently. I did not create a duplicate.',sources:['Notes & Memory']};
  const note={id:uid(),title:'Quick note',content,subject:'Quick note',tags:'chat capture',created:Date.now(),updated:Date.now()};
  pendingChatAction={type:'create-record',collection:'notes',record:note,source:'Notes & Memory',page:'notes',successMessage:'Note Notes & Memory mein save ho gaya: '+content+'.',requestedAt:Date.now()};
  return {answer:'Please confirm note: '+content+'. Reply YES to save or NO to cancel. Abhi note add nahi hua.',sources:['Notes & Memory']};
 }
 const addProject=/\b(?:add|create|start|banao|bana do)\b/i.test(lower)&&/\bproject\b/i.test(lower);
 if(addProject){
  const name=raw.replace(/^\s*(?:please\s+)?(?:add|create|start|banao|bana do)\s+(?:a\s+)?project\s*/i,'').replace(/\s+/g,' ').trim();
  if(!name)return {answer:'Project ka naam batao. Example: Create project Hapn redesign.',sources:['Projects']};
  const duplicate=(data.projects||[]).find(item=>String(item.name||item.title||'').trim().toLowerCase()===name.toLowerCase());
  if(duplicate)return {answer:'A project with this name already exists: "'+(duplicate.name||duplicate.title)+'". I did not create a duplicate.',sources:['Projects']};
  const project={id:uid(),name,description:'',status:'In progress',targetDate:'',created:Date.now(),updated:Date.now()};
  pendingChatAction={type:'create-record',collection:'projects',record:project,source:'Projects',page:'projects',successMessage:'Project created: '+name+'. Projects mein saved aur verified hai.',requestedAt:Date.now()};
  return {answer:'Please confirm project: '+name+'. Reply YES to create or NO to cancel. Abhi project add nahi hua.',sources:['Projects']};
 }

 const updateCue=/\b(?:update|edit|change|modify|rename|set|badal(?:o|na)?|change kar|update kar|theek kar)\b/i.test(lower);
 const entityMatch=lower.match(/\b(task|todo|note|project)\b/i);
 if(updateCue&&entityMatch){
  const type=entityMatch[1].toLowerCase()==='todo'?'task':entityMatch[1].toLowerCase(),collection={task:'tasks',note:'notes',project:'projects'}[type],source={task:'Planner',note:'Notes & Memory',project:'Projects'}[type];
  const records=data[collection]||[],after=raw.slice(entityMatch.index+entityMatch[0].length).trim();
  const toMatch=after.match(/\b(?:to|as|ko|mein|me)\s+(.+)$/i);
  const namePart=after.split(/\b(?:due|deadline|priority|status|description|title|name|notes?|target date|date)\b/i)[0].replace(/^[:\s-]+|[\s,]+$/g,'').replace(/\b(?:called|named)\b/i,'').trim();
  const candidateText=(namePart||after.replace(/^[:\s-]+/,'').trim()).replace(/\s+\b(?:to|as)\s+.+$/i,'').trim();
  const ranked=records.map(record=>{const label=type==='task'?record.title:type==='note'?(record.title||record.content):record.name||record.title;const a=String(label||'').toLowerCase(),b=candidateText.toLowerCase();return {record,label,score:a===b?100:a&&b&&(a.includes(b)||b.includes(a))?50:0}}).filter(x=>x.score).sort((a,b)=>b.score-a.score);
  if(!ranked.length)return {answer:'Matching '+type+' nahi mila. Existing exact title/name ke saath command do.',sources:[source]};
  if(ranked.length>1&&ranked[0].score===ranked[1].score)return {answer:'Multiple '+type+' records match ho rahe hain. Exact title/name batao.',sources:[source]};
  const target=ranked[0],patch={},fieldDate=parseDate();
  if(/\b(?:due|deadline|date)\b/i.test(lower)&&fieldDate){if(type==='task')patch.due=fieldDate;else if(type==='project')patch.targetDate=fieldDate;else return {answer:'Notes ke liye due date field available nahi hai.',sources:[source]}}
  const priority=lower.match(/\b(low|medium|high)\s+priority\b|\bpriority\s+(low|medium|high)\b/i);
  if(priority&&type==='task')patch.priority=(priority[1]||priority[2]).replace(/^./,x=>x.toUpperCase());
  const status=lower.match(/\bstatus\s+(in progress|on hold|completed|complete|done)\b/i);
  if(status&&type==='project')patch.status=/^(complete|done)$/i.test(status[1])?'Completed':status[1].replace(/^./,x=>x.toUpperCase());
  const description=raw.match(/\bdescription\s*[:=]\s*(.+)$/i);
  if(description&&type==='project')patch.description=description[1].trim();
  const notesField=raw.match(/\bnotes?\s*[:=]\s*(.+)$/i);
  if(notesField&&type==='task')patch.notes=notesField[1].trim();
  const rename=raw.match(/\b(?:rename|change|update)\s+(?:the\s+)?(?:title|name)\s+(?:to\s+)?(.+)$/i)||raw.match(/\b(?:to|as)\s+(.+)$/i);
  if(rename&&type==='task')patch.title=rename[1].trim();
  if(rename&&type==='note')patch.title=rename[1].trim();
  if(rename&&type==='project')patch.name=rename[1].trim();
  if(type==='note'&&/\bcontent\s*[:=]/i.test(raw)){patch.content=raw.match(/\bcontent\s*[:=]\s*([\s\S]+)$/i)[1].trim()}
  if(!Object.keys(patch).length)return {answer:'Kya change karna hai clear nahi hua. Example: Update task DSA due tomorrow, set priority high. Ya Rename project Hapn to Hapn v2.',sources:[source]};
  pendingChatAction={type:'update-record',recordType:type,id:target.record.id,title:String(target.label||''),patch,source,requestedAt:Date.now()};
  return {answer:'Please confirm update for '+type+' "'+String(target.label||'')+'": '+Object.entries(patch).map(([key,value])=>key+' → '+value).join('; ')+'. Reply YES to save or NO to cancel. Abhi koi change nahi hua.',sources:[source]};
 }
 const moneyCreateCue=/\b(?:add|save|record|log|track|spent|spend|expense|income|received|earned|kharch|kharcha|kharche|kamaya|mila|payment)\b/i.test(lower);
 const moneyAmount=raw.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?:\s*(?:rupees?|rs\.?|रुपये|रुपए))?/i);
 if(moneyCreateCue&&moneyAmount&&!moneyAddIntent){
  const amount=Number(moneyAmount[1].replace(/,/g,'')),date=fieldDateForMoney();
  const kind=/\b(?:income|received|earned|salary|refund|kamaya|mila|aaye)\b/i.test(lower)?'income':'expense';
  let description=raw.replace(/(?:₹|rs\.?\s*)?[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?(?:\s*(?:rupees?|rs\.?|रुपये|रुपए))?/i,' ')
   .replace(/\b(?:please|add|save|record|log|track|an?\s+)?(?:an?\s+)?(?:expense|income|spending|spent|spend|received|earned|payment|kharch|kharcha|kharche|kamaya|mila|rupees?|rs\.?)\b/ig,' ')
   .replace(/\b(?:today|aaj|yesterday|kal|tomorrow|on|date|in|for)\b/ig,' ')
   .replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g,' ')
   .replace(/\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/ig,' ')
   .replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!Number.isFinite(amount)||amount<=0||!description)return {answer:'Amount aur description dono clear chahiye. Example: Add expense ₹250 for lunch today; income ₹500 from tutoring.',sources:['Money & Udhaar']};
  const category=/food|lunch|dinner|breakfast|chai|coffee|snack|khana/i.test(description)?'Food':/bus|auto|cab|metro|fuel|petrol|travel/i.test(description)?'Travel':/book|stationery|pen|notebook/i.test(description)?'Books & supplies':/fee|college/i.test(description)?'College fees':/movie|game|entertainment/i.test(description)?'Entertainment':/shopping|clothes/i.test(description)?'Shopping':'Other';
  const duplicate=(data.expenses||[]).find(e=>(e.kind||'expense')===kind&&Number(e.amount)===amount&&String(e.description||'').toLowerCase()===description.toLowerCase()&&String(e.date||'')===date);
  if(duplicate)return {answer:'Matching money record already exists: '+fmtMoney(amount)+' for '+description+'. Duplicate nahi banaya.',sources:['Money & Udhaar']};
  const record={id:uid(),description,amount:String(amount),category,date,kind,updated:Date.now(),created:Date.now()};
  pendingChatAction={type:'create-record',collection:'expenses',record,source:'Money & Udhaar',page:'expenses',expenseMonth:date.slice(0,7),successMessage:(kind==='income'?'Income received: ':'Expense saved: ')+fmtMoney(amount)+' for '+description+' on '+dateFmt(date)+'.',requestedAt:Date.now()};
  return {answer:'Please confirm money record: '+(kind==='income'?'income':'expense')+' of '+fmtMoney(amount)+' for '+description+' on '+dateFmt(date)+'. Reply YES to save or NO to cancel. Abhi money record add nahi hua.',sources:['Money & Udhaar']};
 }

 const completionCue=/\b(?:complete(?:d)?|finish(?:ed)?|done|mark(?:ed)?\s+(?:as\s+)?(?:complete(?:d)?|done)|finished)\b|\b(?:ho\s+gaya|ho\s+gya|ho\s+chuka|kar\s+liya|kar\s+diya|khatam|poora\s+ho\s+gaya)\b/i.test(lower);
 const taskCue=/\b(?:task|tasks|todo|to-do|assignment|kaam)\b/i.test(lower);
 const completionIntent=taskCue&&completionCue&&!/\b(?:show|list|what|which|kitne|kitna|batao|dikhao)\b/i.test(lower);
 if(completionIntent){
  const needle=raw.toLowerCase()
   .replace(/\b(?:please|i|have|has|been|the|my|this|that|it|is|ye|yeah|yeh|mera|meri|mere|woh|wo|task|tasks|todo|to-do|assignment|kaam|complete(?:d)?|finish(?:ed)?|done|mark(?:ed)?|as|ho|gaya|gya|chuka|kar|liya|diya|khatam|poora|hogaya|hogya|hochuka)\b/ig,' ')
   .replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim();
  const openTasks=(data.tasks||[]).filter(t=>!t.done);
  const found=needle?openTasks.filter(t=>{const title=String(t.title||'').toLowerCase();return title.includes(needle)||needle.includes(title)}):openTasks;
  if(found.length===1){
   const task=found[0];task.done=true;task.completedAt=Date.now();task.updated=Date.now();persist();
   if(!verify('tasks',task)){task.done=false;delete task.completedAt;return {answer:'Task completion save verify nahi hua. Planner mein task abhi open hi rehna chahiye; dobara try karo.',sources:[]}}
   page='planner';const sync=await syncResult();render();
   return {answer:'Task "'+task.title+'" completed and saved.'+sync,sources:['Planner']};
  }
  if(found.length>1)return {answer:'Ek se zyada open tasks match ho rahe hain. Exact task title likho, jaise: “DSA assignment completed”. Abhi koi task change nahi kiya.',sources:['Planner']};
  return {answer:needle?'Is naam ka koi open task nahi mila. Task ka saved title check karke dobara likho.':'Kaunsa task complete hua? Exact task title batao. Abhi koi task change nahi kiya.',sources:['Planner']};
 }
 const reopen=/\b(?:reopen|undo|uncomplete|mark.*(?:open|pending)|pending kar)\b/i.test(lower);
 if(reopen){
  const needle=raw.replace(/\b(?:please|reopen|undo|uncomplete|mark|as|open|pending|task|the|my)\b/ig,' ').trim().toLowerCase();
  const found=(data.tasks||[]).filter(t=>t.done&&needle&&String(t.title||'').toLowerCase().includes(needle));
  if(found.length===1){found[0].done=false;delete found[0].completedAt;found[0].updated=Date.now();persist();page='planner';render();return {answer:'Task "'+found[0].title+'" moved back to Open Tasks.',sources:['Planner']}}
  return {answer:found.length?'Multiple completed tasks mile. Exact title batao.':'Matching completed task nahi mila.',sources:['Planner']};
 }
 const deleteTask=/\b(?:delete|remove|hata do|delete kar)\b/i.test(lower)&&/\b(?:task|todo|assignment|kaam)\b/i.test(lower);
 if(deleteTask){
  const needle=raw.replace(/\b(?:please|delete|remove|hata do|delete kar|task|todo|assignment|the|my)\b/ig,' ').trim().toLowerCase();
  const found=(data.tasks||[]).filter(t=>needle&&String(t.title||'').toLowerCase().includes(needle));
  if(found.length===1){pendingChatAction={type:'delete-task',id:found[0].id,title:found[0].title,requestedAt:Date.now()};return {answer:'Please confirm: delete task "'+found[0].title+'"? Reply YES to delete or NO to cancel. Nothing has been deleted yet.',sources:['Planner']}}
  return {answer:found.length?'Multiple tasks match. Exact task title batao.':'Task nahi mila; kuch delete nahi kiya.',sources:['Planner']};
 }
 return null;
}
async function sendChat(question,targetDocId=null){
 const query=String(question||'').trim();if(!query||chatBusy)return;
 data.messages.push({role:'user',content:query});if(window.OneAnalytics)window.OneAnalytics.trackEvent('ask_one_message');persist();
 const actionResult=await chatActionIntent(query);
 if(actionResult){data.messages.push({role:'assistant',content:actionResult.answer,sources:actionResult.sources});persist();render();scrollChatToBottom();return}
 if(!targetDocId){
  const detected=detectIntent(query);
  if(detected.ambiguous){const message='Aap Tasks ke baare mein pooch rahe ho ya Notes ke?';data.messages.push({role:'assistant',content:message,sources:[]});persist();render();scrollChatToBottom();return}
  if(!detected.intent){const message='Aap Tasks ke baare mein pooch rahe ho ya Notes ke?';data.messages.push({role:'assistant',content:message,sources:[]});persist();render();scrollChatToBottom();return}
  const localAnswer=answerQuery(detected.intent,query);
  data.messages.push({role:'assistant',content:localAnswer.answer,sources:localAnswer.sources,fileResults:localAnswer.fileResults||[]});persist();render();scrollChatToBottom();return;
 }
 if(isStructuredWorkspaceQuestion(query)&&!targetDocId){
  const local=aiAnswer(query);data.messages.push({role:'assistant',content:local.answer,sources:local.sources});persist();render();scrollChatToBottom();return
 }
 chatBusy=true;render();scrollChatToBottom();
 try{const result=await requestStudentBrainAI(query,targetDocId);data.messages.push({role:'assistant',content:result.answer,sources:result.sources})}
 catch(error){
  console.warn("Operation failed; diagnostic details redacted.");
  const fallback=aiAnswer(query),hasFallback=Array.isArray(fallback.sources)&&fallback.sources.length>0;
  data.messages.push({role:'assistant',content:(hasFallback?fallback.answer+'\n\n':'')+'AI connection: '+(error.message||'Unable to reach the AI service.')+(hasFallback?'\nShowing the local search fallback above.':'\nYour saved data is still stored locally. Retry after the AI setup issue is fixed.'),sources:hasFallback?fallback.sources:[]});
 }finally{chatBusy=false;persist();render();scrollChatToBottom()}
}

function action(name,id,extra){if(name!=='open-quick-add'&&name!=='quick-add-upload'&&name!=='close-quick-add')closeQuickAddMenu();const modalRoot=document.querySelector('#modal-root');if(name!=='open-quick-add'&&name!=='quick-add-upload'&&modalRoot?.querySelector('.quick-add-modal'))modalRoot.innerHTML='';const map={ 'open-quick-add':()=>openQuickAdd(),'extract-document-actions':()=>reviewOneExtractedActions('document',id),'extract-note-actions':()=>reviewOneExtractedActions('note',id),'new-knowledge-entry':()=>openForm('note'),'quick-add-upload':()=>openUploadForm(),'close-quick-add':()=>closeQuickAddMenu(),'new-note':()=>openForm('note'),'new-memory':()=>openMemoryForm(),'edit-memory':()=>openMemoryForm(id),'delete-memory':()=>{if(confirm('Delete this saved memory?')){data.memories=(data.memories||[]).filter(m=>m.id!==id);persist();render();toast('Memory deleted')}},'go-memory':()=>{page='memory';render()},'voice-quick-command':()=>{if(window.startStudentBrainListening)window.startStudentBrainListening();else toast('Voice assistant is loading. Try again.');},'edit-note':()=>openForm('note',id),'delete-note':()=>confirmDelete('notes',id),'delete-document':()=>{if(confirm('Delete this document and its saved file?')){removeOriginalDocument(id);data.documents=(data.documents||[]).filter(d=>d.id!==id);persist();render();toast('Document deleted')}},'open-uploaded-file':()=>openUploadedFile(id,false),'download-uploaded-file':()=>openUploadedFile(id,true),'rename-uploaded-file':()=>{const file=(data.documents||[]).find(item=>item.id===id);if(!file)return;editing=id;formType='fileRename';modal('Rename file',field('Naam','name',file.name,'text',{required:true,full:true})+field('Tags / Keywords','tags',(file.tags||[]).join(', '),'text',{full:true})+field('Note','note',file.note||'','textarea',{full:true}),'Save changes')},'delete-uploaded-file':()=>{if(confirm('Delete this file?'))deleteFile(id).then(()=>{render();toast('File deleted')})},'toggle-document-pin':()=>{const doc=(data.documents||[]).find(d=>d.id===id);if(doc){doc.pinned=!doc.pinned;doc.pinnedAt=doc.pinned?Date.now():null;persist();render();toast(doc.pinned?'Document pinned':'Document unpinned')}},'save-document-expiry':()=>{const doc=(data.documents||[]).find(d=>d.id===id),value=document.querySelector('#document-expiry-'+CSS.escape(id))?.value||'';if(!doc)return;if(value&&!/^\d{4}-\d{2}-\d{2}$/.test(value)){toast('Choose a valid expiry date');return}doc.expiresOn=value||null;doc.expiryReminderDays=Array.isArray(doc.expiryReminderDays)?doc.expiryReminderDays:[30,7,1,0];persist();render();toast(value?'Document expiry saved':'Expiry date cleared')},'connect-document-note':()=>{const doc=(data.documents||[]).find(d=>d.id===id),noteId=document.querySelector('[data-document-note-select="'+CSS.escape(id)+'"]')?.value;if(!doc||!noteId){toast('Choose a note first');return}doc.relatedNoteIds=Array.isArray(doc.relatedNoteIds)?doc.relatedNoteIds:[];if(!doc.relatedNoteIds.includes(noteId))doc.relatedNoteIds.push(noteId);persist();render();toast('Related note connected')},'summarize-document':()=>summarizeDocument(id),'open-vault-result':()=>openVaultResult(id),'retry-document-ocr':()=>retryDocumentOCR(id),'convert-document-json':()=>convertDocumentToJSON(id),'copy-document-json':()=>copyDocumentJSON(id),'download-document-json':()=>downloadDocumentJSON(id),'save-document-json':()=>{const doc=(data.documents||[]).find(d=>d.id===id);if(doc?.extractedJson){doc.jsonSavedToKnowledge=true;doc.jsonSavedAt=Date.now();doc.jsonStatus='saved_to_knowledge';persist();render();toast('JSON saved to My Knowledge')}else toast('Convert to JSON first')},'ask-document':()=>askDocument(id),'new-task':()=>{openForm('task');if(window.plannerSelectedDate){const dueField=document.querySelector('#edit-form [name=due]');if(dueField)dueField.value=window.plannerSelectedDate}},'enable-reminders':()=>enableTaskReminders(),'open-notifications':()=>notificationCentre(),'snooze-task-10':()=>snoozeTaskReminder(id,10),'snooze-task-60':()=>snoozeTaskReminder(id,60),'snooze-task-1440':()=>snoozeTaskReminder(id,1440),'reschedule-notification-task':()=>openForm('task',id),'complete-notification-task':()=>{const task=(data.tasks||[]).find(t=>t.id===id);if(task&&!task.done){task.done=true;task.completedAt=Date.now();task.updated=Date.now();(data.notifications||[]).filter(n=>n.taskId===id).forEach(n=>n.read=true);persist();notificationCentre();toast('Reminder marked complete')}},'open-notification-note':()=>{const item=(data.notifications||[]).find(x=>x.id===id);if(item?.relatedId){const note=(data.notes||[]).find(n=>n.id===item.relatedId);if(note){document.querySelector('#modal-root').innerHTML='';page='notes';window.noteQuery=note.title||'';render();requestAnimationFrame(()=>document.querySelector('.note-card')?.scrollIntoView({behavior:'smooth',block:'center'}));}}},'open-notification-document':()=>{const item=(data.notifications||[]).find(x=>x.id===id);if(item?.relatedId){document.querySelector('#modal-root').innerHTML='';page='vault';render();requestAnimationFrame(()=>document.querySelector('#vault-document-'+CSS.escape(item.relatedId))?.scrollIntoView({behavior:'smooth',block:'center'}));}},'mark-notification-read':()=>{const item=(data.notifications||[]).find(x=>x.id===id);if(item){item.read=true;persist();notificationCentre();}},'mark-all-notifications-read':()=>{(data.notifications||[]).forEach(item=>item.read=true);persist();notificationCentre();},'open-notification-task':()=>{const item=(data.notifications||[]).find(x=>x.id===id);if(item?.taskId){const task=data.tasks.find(t=>t.id===item.taskId);if(task){document.querySelector('#modal-root').innerHTML='';page='planner';window.plannerView='All';render();requestAnimationFrame(()=>document.querySelector('[data-action="edit-task"][data-id="'+CSS.escape(task.id)+'"]')?.scrollIntoView({behavior:'smooth',block:'center'}));}}},'share-task-whatsapp':()=>shareTaskReminder(id,'whatsapp'),'share-task-telegram':()=>shareTaskReminder(id,'telegram'),'save-money-budget':()=>{const amount=Number(document.querySelector('#money-budget-amount')?.value||0),month=window.expenseMonth||today().slice(0,7);if(!Number.isFinite(amount)||amount<=0){toast('Enter a valid monthly budget');return}data.moneyBudgets=Array.isArray(data.moneyBudgets)?data.moneyBudgets:[];const existing=data.moneyBudgets.find(x=>x.month===month);if(existing)existing.amount=amount;else data.moneyBudgets.push({month,amount,updated:Date.now()});persist();render();toast('Monthly budget saved')},'new-study':()=>openForm('study'),'edit-task':()=>openForm('task',id),'delete-task':()=>confirmDelete('tasks',id),'new-project':()=>openForm('project'),'edit-project':()=>openForm('project',id),'new-expense':()=>{openForm('expense');if(id&&['lent','borrowed'].includes(id)){const kindField=document.querySelector('#edit-form [name=kind]');if(kindField)kindField.value=id;const categoryField=document.querySelector('#edit-form [name=category]');if(categoryField)categoryField.value='Udhaar'}},'loan-repayment':()=>{const person=id,hasLent=data.expenses.some(e=>e.person===person&&e.kind==='lent');openForm('expense');const kindField=document.querySelector('#edit-form [name=kind]');if(kindField)kindField.value=hasLent?'lent_repayment':'borrowed_repayment';const personField=document.querySelector('#edit-form [name=person]');if(personField)personField.value=person;const categoryField=document.querySelector('#edit-form [name=category]');if(categoryField)categoryField.value='Repayment';const descriptionField=document.querySelector('#edit-form [name=description]');if(descriptionField)descriptionField.value=(hasLent?'Received from ':'Repaid to ')+person},'loan-person-history':()=>{window.loanPersonFilter=id;page='loans';render();document.querySelector('.loan-history-title')?.scrollIntoView({behavior:'smooth'})},'loan-clear-filter':()=>{window.loanPersonFilter='';render()},'expense-quick-action':()=>{if(id==='all'){window.expenseMonth='';render();return}openForm('expense');const typeField=document.querySelector('#edit-form [name=kind]');if(typeField){typeField.value=id;typeField.dispatchEvent(new Event('change',{bubbles:true}))}const descriptionField=document.querySelector('#edit-form [name=description]');if(descriptionField){descriptionField.focus();descriptionField.setSelectionRange?.(0,descriptionField.value.length)}const categoryField=document.querySelector('#edit-form [name=category]');if(categoryField&&id.includes('repayment'))categoryField.value='Repayment';const personField=document.querySelector('#edit-form [name=person]');if(personField&&id!=='expense')personField.placeholder='Who was the money for/from?'},'edit-expense':()=>openForm('expense',id),'delete-expense':()=>confirmDelete('expenses',id),'delete-study':()=>{data.studySessions=(data.studySessions||[]).filter(x=>x.id!==id);persist();render();toast('Study session removed')},'planner-view':()=>{window.plannerView=id;render();requestAnimationFrame(()=>document.querySelector('.planner-view-heading')?.scrollIntoView({behavior:'smooth',block:'start'}))},'planner-date':()=>{window.plannerSelectedDate=id;render();document.querySelector('.planner-selected-date')?.scrollIntoView({behavior:'smooth',block:'nearest'})},'planner-month':()=>{const base=window.plannerMonth||today().slice(0,7);if(id==='today')window.plannerMonth=today().slice(0,7);else{const [year,month]=base.split('-').map(Number),next=new Date(year,month-1+(id==='next'?1:-1),1);window.plannerMonth=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')}window.plannerSelectedDate=null;render()},'go-ask':()=>{page='ask';render()},'toggle-task-section':()=>{window.taskSectionExpanded=(window.taskSectionExpanded||'open')===id?'':id;render();},'go-planner':()=>{page='planner';window.plannerView='All';render()},'go-udhaar':()=>{page='expenses';window.moneyTab='udhaar';render()},'go-money-reports':()=>{page='expenses';window.moneyTab='reports';window.expenseMonth=today().slice(0,7);render()},'go-knowledge':()=>{page='knowledge';render()},'toggle-task':()=>{let t=data.tasks.find(x=>x.id===id);if(!t)return;t.done=!t.done;if(t.done)t.completedAt=Date.now();else delete t.completedAt;persist();render();toast(t.done?'Task marked complete':'Task moved back to open tasks')},'all-expenses':()=>{window.expenseMonth='';render()},'export-data':()=>exportData(),'restore-data':()=>restoreData(),'clear-data':()=>clearData(),'close-modal':()=>{window.oneActionReview=null;document.querySelector('#modal-root').innerHTML='';closeQuickAddMenu();document.querySelector('.floating-create-button')?.classList.remove('is-hidden')}};map[name]?.()}
function confirmDelete(key,id){const item=data[key].find(x=>x.id===id);if(!item)return;if(confirm(`Delete "${item.title||item.name||item.description}"? This cannot be undone.`)){data[key]=data[key].filter(x=>x.id!==id);persist();render();toast('Deleted')}}
function restoreData(){const f=document.querySelector('#restore-file')?.files?.[0];if(!f){toast('Choose a JSON backup first');return}const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed||!Array.isArray(parsed.notes)||!Array.isArray(parsed.tasks))throw Error('Invalid backup');if(!confirm('Restore this backup and replace current workspace data?'))return;data={...starter(),...parsed};persist();page='overview';render();toast('Backup restored')}catch(e){toast('Invalid Student Brain backup file')}};reader.readAsText(f)}
function exportData(){try{const payload={app:'Student Brain',backupVersion:1,exportedAt:new Date().toISOString(),data:migrateData(data)},blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='student-brain-backup-'+today()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup downloaded')}catch(err){console.warn("Operation failed; diagnostic details redacted.");toast('Could not create backup. Check browser storage and try again.')}}
function parseBackupPayload(parsed){
 const payload=parsed?.app==='Student Brain'&&parsed?.data?parsed.data:parsed;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.notes)||!Array.isArray(payload.tasks))throw Error('This file is not a valid Student Brain backup.');
 for(const key of ['projects','expenses','messages','studySessions','documents','memories'])if(payload[key]!==undefined&&!Array.isArray(payload[key]))throw Error('Backup data looks damaged ('+key+'). No data was changed.');
 return migrateData(payload);
}
function updateRestorePreview(){
 const file=document.querySelector('#restore-file')?.files?.[0],preview=document.querySelector('#restore-preview');if(!preview)return;
 if(!file){preview.textContent='No backup selected. Current workspace data will remain unchanged until you confirm.';return}
 if(file.size>20*1024*1024){preview.textContent='File exceeds the 20 MB restore limit. No data has changed.';return}
 const reader=new FileReader();
 reader.onload=()=>{try{const parsed=JSON.parse(reader.result),payload=parseBackupPayload(parsed);preview.textContent='Valid backup · '+(parsed?.exportedAt?'Created '+new Date(parsed.exportedAt).toLocaleString():'No export date')+' · '+payload.notes.length+' notes · '+payload.tasks.length+' tasks · '+payload.expenses.length+' money records. Restore replaces current data after confirmation.'}catch(err){preview.textContent=(err.message||'Invalid backup')+' No data has changed.'}};
 reader.onerror=()=>{preview.textContent='Could not read this file. Select it again.'};reader.readAsText(file);
}
function restoreData(){
 const f=document.querySelector('#restore-file')?.files?.[0];if(!f){toast('Choose a JSON backup first');return}
 if(f.size>20*1024*1024){toast('Backup too large (20 MB maximum)');return}
 const reader=new FileReader();
 reader.onload=()=>{try{
  const parsed=JSON.parse(reader.result),next=parseBackupPayload(parsed);
  const exportedAt=parsed?.exportedAt&&Number.isFinite(Date.parse(parsed.exportedAt))?new Date(parsed.exportedAt).toLocaleString():null;
  if(!confirm('Restore '+(exportedAt?'backup from '+exportedAt:'this backup')+' and replace current workspace data? A recovery snapshot of the current workspace will be saved first.'))return;
  localStorage.setItem(workspaceStorageKey()+'-pre-restore',JSON.stringify(migrateData(data)));data=next;persist();page='overview';render();toast('Backup restored. Previous data is saved as a recovery snapshot.');
 }catch(err){console.warn("Operation failed; diagnostic details redacted.");toast(err.message||'Invalid backup file')}};
 reader.onerror=()=>toast('Could not read backup file. Try selecting it again.');reader.readAsText(f);
}
function clearData(){if(confirm('Delete all Student Brain data saved in this browser? Export first if you need a backup.')){data=starter();persist();render();toast('Local data cleared')}}
document.addEventListener('click',e=>{const moneyTab=e.target.closest('[data-money-tab]');if(moneyTab){window.moneyTab=moneyTab.dataset.moneyTab;page='expenses';render();return}const copyButton=e.target.closest('[data-copy-message]');if(copyButton){const index=Number(copyButton.dataset.copyMessage);const message=data.messages[index];if(message){const value=String(message.content||'');if(navigator.clipboard?.writeText){navigator.clipboard.writeText(value).then(()=>toast('Message copied')).catch(()=>toast('Could not copy message'));}else{const temp=document.createElement('textarea');temp.value=value;temp.style.position='fixed';temp.style.opacity='0';document.body.appendChild(temp);temp.select();try{document.execCommand('copy');toast('Message copied')}catch(_){toast('Could not copy message')}temp.remove();}}return}const choice=e.target.closest('[data-choice-name]');if(choice){const form=choice.closest('form');const input=form?.querySelector('[name="'+choice.dataset.choiceName+'"]');if(input){input.value=choice.dataset.choiceValue;choice.parentElement.querySelectorAll('[data-choice-name="'+choice.dataset.choiceName+'"]').forEach(option=>{const selected=option===choice;option.classList.toggle('is-selected',selected);option.setAttribute('aria-pressed',selected?'true':'false')})}return}if(e.target.closest('.create-radial-backdrop')){e.preventDefault();closeQuickAddMenu();return}const backdrop=e.target.closest('.modal-backdrop');if(backdrop&&e.target===backdrop){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal')){const modalAction=e.target.closest('[data-action]');if(modalAction){e.preventDefault();e.stopPropagation();action(modalAction.dataset.action,modalAction.dataset.id);return}return}const close=e.target.closest('[data-action="close-modal"]');if(close){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal'))return;const pg=e.target.closest('[data-page]');if(pg){document.querySelector('#modal-root').innerHTML='';page=pg.dataset.page;history.pushState({sbPage:page},'',location.href);render();return}const a=e.target.closest('[data-action]');if(a){action(a.dataset.action,a.dataset.id,a.dataset.minutes);return}const q=e.target.closest('[data-question]');if(q){sendChat(q.dataset.question);return}});
document.addEventListener('click',e=>{if(e.target.closest('#quick-capture-voice')){quickCaptureVoice();}});
document.addEventListener('submit',e=>{if(e.target.id==='edit-form'&&window.oneActionReview&&e.target.querySelector('[name="oneActionPick"]')){e.preventDefault();saveOneExtractedActions(e.target);return}if(e.target.id==='home-quick-note-form'){e.preventDefault();const fd=new FormData(e.target),content=String(fd.get('content')||'').trim(),title=String(fd.get('title')||'').trim();if(!content){toast('Write something first');return}data.notes.push({id:uid(),title:title||'Quick note',content,subject:'Quick note',tags:'quick capture',created:Date.now(),updated:Date.now()});persist();e.target.reset();toast('Note saved to One');return}if(e.target.id==='edit-form')saveForm(e);if(e.target.id==='chat-form'){e.preventDefault();const i=document.querySelector('#chat-input');sendChat(i.value);}if(e.target.id==='home-brain-search'){e.preventDefault();const q=document.querySelector('#home-brain-query')?.value.trim();page='ask';render();if(q)sendChat(q);else document.querySelector('#chat-input')?.focus()}});
document.addEventListener('input',e=>{if(e.target.id==='vault-search'){window.vaultSearchQuery=e.target.value;const old=document.querySelector('.vault-search-results');if(old)old.remove();const box=document.querySelector('.vault-search-card');if(box){const q=window.vaultSearchQuery.trim(),results=q?phase5SearchResults(q):[];if(q){const wrap=document.createElement('div');wrap.className='vault-search-results';wrap.innerHTML=results.length?results.map(x=>'<button class=\"vault-search-result\" type=\"button\" data-action=\"open-vault-result\" data-id=\"'+esc(x.id)+'\" data-type=\"'+esc(x.type)+'\"><span><b>'+esc(x.title)+'</b><small>'+esc(x.type)+' · '+esc(x.detail)+'</small></span><span>Open ↗</span></button>').join(''):'<p class=\"muted\">No matching records found.</p>';box.appendChild(wrap)}}}if(e.target.id==='vault-document-search'){window.vaultDocumentQuery=e.target.value;const el=document.querySelector('#vault-documents');if(el)el.innerHTML=documentsCards()}if(e.target.id==='note-search'){window.noteQuery=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}});
document.addEventListener('change',e=>{if(e.target.matches('[data-ai-share]')){data.aiPrivacy=data.aiPrivacy||{};data.aiPrivacy[e.target.dataset.aiShare]=e.target.checked;persist();toast('AI data sharing preference saved')}if(e.target.id==='restore-file')updateRestorePreview();if(e.target.id==='document-upload'){const file=e.target.files?.[0];e.target.value='';if(file)openFileMetadataDialog(file);}if(e.target.id==='quick-add-file-upload'){const selected=e.target.files?.[0];e.target.value='';if(selected)openFileMetadataDialog(selected)}if(e.target.id==='subject-filter'){window.subjectFilter=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}if(e.target.id==='task-filter'){window.taskFilter=e.target.value;render()}if(e.target.id==='expense-month'){window.expenseMonth=e.target.value;render()}});

function parseStructuredVoiceCapture(raw){
 const text=String(raw||'').trim(),lower=text.toLowerCase();
 const amountMatch=text.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?:\s*(?:rupees?|rs\.?|रुपये|रुपए))?/i);
 const amount=amountMatch?Number(amountMatch[1].replace(/,/g,'')):0;
 if(!amount||!/\b(?:udhaar|lend|lent|gave|given|diya|diye|loan)\b/i.test(lower))return null;
 const personMatch=text.match(/\b([A-Z][a-z]{2,})\s+(?:ko|se)\b/);
 if(!personMatch)return null;
 const person=personMatch[1].trim().replace(/^./,c=>c.toUpperCase());
 const todayValue=today(),[year,month,day]=todayValue.split('-').map(Number);
 const dateString=(y,m,d)=>y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
 let transactionDate=todayValue;
 if(/\bkal\b/i.test(lower)&&/\b(?:diya|diye|diye the|diya tha|gave|lent)\b/i.test(lower))transactionDate=dateString(...(()=>{const d=new Date(year,month-1,day-1);return [d.getFullYear(),d.getMonth()+1,d.getDate()]})());
 const dayMatch=lower.match(/\b(\d{1,2})\s*(?:tarikh| तारीख|th|date)\b/i);
 let dueDate='';
 if(dayMatch){
  let dueDay=Number(dayMatch[1]),dueMonth=month,dueYear=year;
  if(dueDay>=1&&dueDay<=31){
   let candidate=new Date(dueYear,dueMonth-1,dueDay);
   if(candidate.getDate()!==dueDay)return null;
   if(candidate.getTime()<new Date(year,month-1,day).getTime()){dueMonth++;if(dueMonth>12){dueMonth=1;dueYear++}}
   dueDate=dateString(dueYear,dueMonth,dueDay);
  }
 }
 const followupCue=/\b(?:baat karni|discuss|talk|follow.?up|milna|call karna)\b/i.test(lower);
 const projectCue=/\bproject\b/i.test(lower);
 const taskTitle=followupCue?(projectCue?'Follow up with '+person+' about the project':'Follow up with '+person):'Follow up with '+person;
 return {text,person,amount,transactionDate,dueDate,taskTitle,hasFollowup:followupCue};
}

window.handleStudentBrainVoiceCommand = function(raw) {
 const text=String(raw||'').trim(), lower=text.toLowerCase();
 if(!text)return false;
 const m=text.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?:\s*(?:rupees?|rs\.?|रुपये|रुपए))?/i);
 const amount=m?Number(m[1].replace(/,/g,'')):null;
 const structuredCapture=parseStructuredVoiceCapture(text);
 if(structuredCapture){
  const existingPerson=(data.people||[]).find(p=>String(p.name||'').toLowerCase()===structuredCapture.person.toLowerCase());
  const personId=existingPerson?.id||uid(),now=Date.now();
  const expense={id:uid(),description:'Udhaar to '+structuredCapture.person,amount:String(structuredCapture.amount),category:'Udhaar',date:structuredCapture.transactionDate,dueDate:structuredCapture.dueDate,kind:'lent',person:structuredCapture.person,personId,updated:now,created:now,source:'voice-structured-capture'};
  const task=structuredCapture.hasFollowup?{id:uid(),title:structuredCapture.taskTitle,category:'Follow-up',priority:'Medium',due:'',done:false,person:structuredCapture.person,personId,notes:'Captured from voice: '+structuredCapture.text,updated:now,created:now,source:'voice-structured-capture'}:null;
  const note={id:uid(),title:'Voice capture · '+structuredCapture.person,content:structuredCapture.text,subject:'Conversation',tags:'voice,structured capture,people',personIds:[personId],created:now,updated:now,source:'voice-structured-capture'};
  const preview=['Save structured voice capture?','', 'Person: '+structuredCapture.person,'Udhaar: ₹'+structuredCapture.amount.toLocaleString('en-IN')+' · '+dateFmt(structuredCapture.transactionDate),'Return due: '+(structuredCapture.dueDate?dateFmt(structuredCapture.dueDate):'Not detected'),task?'Follow-up: '+task.title:'Follow-up: Not detected','Note: Save original conversation'].join('\\n');
  if(!confirm(preview)){toast('Capture cancelled. Nothing was saved.');const s=document.querySelector('#voice-status');if(s)s.textContent='Cancelled. No records were saved.';speakVoiceConfirmation('Cancelled. Nothing was saved.');return true}
  data.people=Array.isArray(data.people)?data.people:[];
  let person=existingPerson;
  if(!person){person={id:personId,name:structuredCapture.person,created:now,updated:now,interactions:[]};data.people.push(person)}
  person.updated=now;person.lastInteractionAt=now;person.interactions=Array.isArray(person.interactions)?person.interactions:[];
  person.interactions.push({id:uid(),date:structuredCapture.transactionDate,summary:structuredCapture.text,source:'voice'});
  data.expenses.push(expense);if(task)data.tasks.push(task);data.notes.push(note);
  persist();page='expenses';window.moneyTab='udhaar';render();
  const done='Saved structured capture: ₹'+structuredCapture.amount.toLocaleString('en-IN')+' udhaar for '+structuredCapture.person+(structuredCapture.dueDate?', return due '+dateFmt(structuredCapture.dueDate):'')+(task?'; follow-up task and note saved.':'; note saved.');
  toast('Voice capture saved to One');const s=document.querySelector('#voice-status');if(s)s.textContent=done;speakVoiceConfirmation(done);return true;
 }
 const localDateString=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const months={january:0,jan:0,february:1,feb:1,march:2,mar:2,april:3,apr:3,may:4,june:5,jun:5,july:6,jul:6,august:7,aug:7,september:8,sep:8,sept:8,october:9,oct:9,november:10,nov:10,december:11,dec:11};
 let due='';
 const dm=lower.match(/\b(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(\d{4}))?\b/i);
 if(dm){let y=dm[3]?+dm[3]:new Date().getFullYear(),mo=months[dm[2]];if(!dm[3]&&new Date(y,mo,+dm[1])<new Date(new Date().setHours(0,0,0,0)))y++;due=localDateString(new Date(y,mo,+dm[1]))}
 else if(/\btomorrow\b|\bkal\b/i.test(lower)){let d=new Date();d.setDate(d.getDate()+1);due=localDateString(d)}
 else if(/\btoday\b|\baaj\b/i.test(lower))due=today();
 else {const w=lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);if(w){const days={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};let d=new Date(),delta=(days[w[1]]-d.getDay()+7)%7||7;d.setDate(d.getDate()+delta);due=localDateString(d)}}
 const taskListIntent=/\b(?:what(?:'s| is)?\s+(?:my\s+)?(?:task|tasks|todo|to-do)|which\s+tasks?|show\s+(?:my\s+)?tasks?|list\s+(?:my\s+)?tasks?|(?:my|mere|meri|mera)\s+(?:pending\s+)?tasks?|pending\s+tasks?|maine\s+(?:kya|kaun\s+sa|kaunse)\s+(?:task|tasks)?\s*(?:save|saved|add|kiya|kiye|kiye\s+the)?|kya\s+(?:task|tasks)\s*(?:hai|hain|the|thi)?|(?:task|tasks)\s+(?:batao|batana|dikhao|sunao|padh(?:o)?|kya\s+hai)|(?:batao|dikhao|sunao)\s+(?:mere|meri|mera)?\s*(?:task|tasks)|read\s+(?:my\s+)?tasks?|tell\s+me\s+(?:my\s+)?tasks?|what\s+did\s+i\s+save)\b/i.test(lower);
 if(taskListIntent){
  const all=(data.tasks||[]);
  const includeDone=/completed|done|finished|complete|ho\s+gaye|kar\s+liye/i.test(lower);
  const tasks=all.filter(t=>includeDone||!t.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  const say=tasks.length?(includeDone?'Your saved tasks are: ':'Your pending tasks are: ')+tasks.slice(0,8).map((t,i)=>(i+1)+'. '+t.title+(t.due?', due '+dateFmt(t.due):'')+(t.done?', completed':'')).join('. ')+'. '+(tasks.length>8?'And '+(tasks.length-8)+' more. ':'')+'Total '+tasks.length+'.':'No matching tasks are saved.';
  toast(tasks.length?'Found '+tasks.length+' task(s).':'No matching tasks.');
  speakVoiceConfirmation(say);
  const voiceStatus=document.querySelector('#voice-status');if(voiceStatus)voiceStatus.textContent=say;
  alert(say);
  return true;
 }
 const moneyIntent=amount!==null&&/rupee|rs\.?|₹|udhaar|lend|lent|borrow|paid|spent|kharch|diye|diya|wapas|return|expense|lunch|food|रुपये|रुपए/i.test(lower);
 if(moneyIntent){
  let category='Other',kind='expense';
  if(/udhaar|lend|lent|diye|diya|gave/i.test(lower)){category='Lent / Udhaar';kind='lent'}
  else if(/wapas|return|repay|repaid/i.test(lower)){category='Udhaar returned';kind='repayment'}
  else if(/food|lunch|dinner|breakfast|khana/i.test(lower))category='Food';
  else if(/travel|bus|cab|auto/i.test(lower))category='Travel';
  const desc=text.replace(/\\b(i\\s+)?(spent|paid|gave|lent|borrowed|returned|repaid|kharch(?:a)?|diya|diye|wapas)\\b/ig,'').replace(/₹|rs\\.?|rupees?|रुपये|रुपए/ig,'').replace(/[0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?/g,'').replace(/\\b(today|aaj|tomorrow|kal)\\b/ig,'').replace(/\\s+/g,' ').replace(/^[\\s,.:;-]+|[\\s,.:;-]+$/g,'').trim()||category;
  const recordDate=due||today(),amountLabel='₹'+amount.toLocaleString('en-IN');
  const moneySummary='Save this money record?\\n\\nType: '+category+' ('+kind+')\\nAmount: '+amountLabel+'\\nFor / person: '+desc+'\\nDate: '+dateFmt(recordDate);
  if(!confirm(moneySummary)){toast('Money record not saved');const voiceStatus=document.querySelector('#voice-status');if(voiceStatus)voiceStatus.textContent='Cancelled. No money record was saved.';speakVoiceConfirmation('Cancelled. No money record was saved.');return true}
  data.expenses.push({id:uid(),description:desc,amount:String(amount),category,date:recordDate,kind,updated:Date.now(),created:Date.now()});
  persist();page='expenses';window.expenseMonth=recordDate.slice(0,7);render();toast('Money record saved: '+amountLabel);const moneyConfirmation='Saved '+category+' '+amountLabel+' on '+dateFmt(recordDate)+'.';const voiceStatus=document.querySelector('#voice-status');if(voiceStatus)voiceStatus.textContent=moneyConfirmation;speakVoiceConfirmation(moneyConfirmation);return true;
 }
 const taskCue=/\b(task|tasks|to[ -]?do|assignment|homework|deadline|last date|due date|due|submit|exam|remind(?:er)?|project|study|studying|revise|revision|prepare|preparation|read|reading|practice|practise|write|writing|call|buy|kaam|padhai|karna hai|yaad dilana)\b/i.test(lower);
 const taskQuestionIntent=taskCue&&/\b(what|which|show|list|tell me|how many|do i have|are there|kya|kaunse|kaunsa|batao|dikhao|mere tasks|meri tasks)\b/i.test(lower);
 const taskCreateIntent=/\b(add|create|make|save|remind me|schedule|set up|i need to|i have to|need to|have to|i will|will|must|should|finish|complete|submit|prepare|revise|study|read|practice|practise|write|call|buy|don't forget|do not forget|bana(?:o|na)|likh(?:o|na)|karna hai|yaad rakh(?:na|na hai)|mujhe)\b/i.test(lower);
 if(taskCue&&!taskQuestionIntent&&(taskCreateIntent||!!due)){
  let title=text
   .replace(/\b(?:please|i|need|have|to|must|should|don't|do|not|forget|me|mere liye|mere|mujhe|my|add|create|make|new|a|an|the|task|tasks|to[ -]?do|remind(?:er)?|yaad dilana|kar do|karna hai|bana do|banao|save|in planner|finish|complete|submit|prepare|revise|study)\b/ig,' ')
   .replace(/\b(?:kal|tomorrow|today|aaj|on|by|due|deadline|last date|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ig,' ')
   .replace(/\b\d{1,2}\s+(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+\d{4})?\b/ig,' ')
   .replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title)title=text.trim();
  const task={id:uid(),title,category:/assignment|submit/i.test(lower)?'Assignment':/exam|paper/i.test(lower)?'Exam':/project/i.test(lower)?'Project':/study|revise|padhai/i.test(lower)?'Study':'Personal',due,priority:/urgent|important|high priority|jaldi/i.test(lower)?'High':'Medium',done:false,updated:Date.now(),created:Date.now()};
  const taskSummary='Save this task?\\n\\n'+task.title+'\\nCategory: '+task.category+'\\nPriority: '+task.priority+'\\nDue: '+(due?dateFmt(due):'No due date');
  if(!confirm(taskSummary)){toast('Task not saved');const voiceStatus=document.querySelector('#voice-status');if(voiceStatus)voiceStatus.textContent='Task cancelled. Nothing was saved.';speakVoiceConfirmation('Task cancelled. Nothing was saved.');return true}
  data.tasks.push(task);
  persist();
  page='planner';
  const taskToday=today();
  const nextDay=new Date(taskToday+'T12:00:00');
  nextDay.setDate(nextDay.getDate()+1);
  const tomorrowKey=nextDay.getFullYear()+'-'+String(nextDay.getMonth()+1).padStart(2,'0')+'-'+String(nextDay.getDate()).padStart(2,'0');
  window.plannerView=!due?'All':due<taskToday?'Overdue':due===taskToday?'Today':due===tomorrowKey?'Tomorrow':'Upcoming';
  render();
  toast('Task saved: '+title);
  const voiceStatus=document.querySelector('#voice-status');
  if(voiceStatus)voiceStatus.textContent='Saved to Planner: '+title+(due?' · '+dateFmt(due):'');
  speakVoiceConfirmation('Saved task: '+title+(due?' due '+dateFmt(due):'. No due date set.'));
  return true;
 }
 return false;
};

// Accept speech from the mobile Speak button on every page, not only Ask My Brain.
window.submitStudentBrainVoiceText = function(raw) {
 const phrase=String(raw||'').trim();
 if(!phrase)return false;
 try {
  // Money/udhaar commands are handled exclusively by the money-record flow.
  const hasAmount=/(?:₹|\\brs\\.?\\s*)?\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:\\s*(?:rupees?|rs\\.?|रुपये|रुपए))?/i.test(phrase);
  const isMoneyCommand=hasAmount&&/rupee|rs\\.?|₹|udhaar|lend|lent|borrow|paid|spent|kharch|diye|diya|wapas|return|expense|lunch|food|रुपये|रुपए/i.test(phrase);
  if(isMoneyCommand&&typeof window.handleStudentBrainVoiceCommand==='function')return window.handleStudentBrainVoiceCommand(phrase);
  // Every other spoken command is saved verbatim as a Knowledge Entry.
  const now=Date.now();
  const title='Voice Entry · '+new Date(now).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'});
  data.notes.push({id:uid(),title,subject:'Knowledge',content:phrase,tags:'knowledge,voice',created:now,updated:now});
  persist();
  page='knowledge';
  render();
  toast('Voice command saved to Knowledge');
  const voiceStatus=document.querySelector('#voice-status');
  if(voiceStatus)voiceStatus.textContent='Saved to Knowledge: '+phrase;
  speakVoiceConfirmation('Saved to Knowledge.');
  return true;
 } catch(err) {
  console.warn("Operation failed; diagnostic details redacted.");
  toast('Could not save that voice command. Please try again.');
  return false;
 }
};

function shareTaskReminder(id,channel){
 const task=(data.tasks||[]).find(t=>t.id===id);if(!task){toast('Task not found');return}
 const due=task.due?'Due: '+dateFmt(task.due)+' at '+(task.reminderTime||'09:00'):'No due date set';
 const message='Reminder from One: '+task.title+' · '+due+' · Priority: '+(task.priority||'Medium')+'\n'+location.href;
 const url=channel==='whatsapp'?'https://wa.me/?text='+encodeURIComponent(message):'https://t.me/share/url?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent('Reminder from One: '+task.title+' · '+due+' · Priority: '+(task.priority||'Medium'));
 window.open(url,'_blank','noopener,noreferrer');
}
const TASK_REMINDER_KEY='student-brain-task-reminders-shown-v1';
function taskReminderStorageKey(){return TASK_REMINDER_KEY+'-'+(activeWorkspaceUserId||'guest');}
function taskReminderDayTime(task){if(!task.due)return null;const [y,m,d]=task.due.split('-').map(Number),[hh,mm]=String(task.reminderTime||'09:00').split(':').map(Number);return new Date(y,m-1,d,hh||0,mm||0,0,0).getTime()}
async function enableTaskReminders(){
 if(!('Notification' in window)){toast('This browser does not support notifications');return}
 try{
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){toast('Notifications blocked. Allow them in browser site settings.');return}
  toast('In-app reminders enabled');
  await checkTaskReminders();
  if(cloudReady&&cloudUser?.id&&'PushManager' in window&&navigator.serviceWorker){
   try{await enableAndroidPush();toast('Android push notifications connected')}
   catch(error){console.warn("Operation failed; diagnostic details redacted.");toast('In-app reminders enabled. Push setup needs server configuration.')}
  }else toast('In-app reminders enabled. Sign in to connect Android push.');
 }catch(err){toast('Could not enable notifications')}
}
function base64UrlToBytes(value){
 const padding='='.repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
 return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
}
async function enableAndroidPush(){
 if(!cloudClient||!cloudUser?.id)throw new Error('Sign in to One first.');
 const registration=await navigator.serviceWorker.ready;
 if(!registration.pushManager)throw new Error('Push notifications are not supported by this browser.');
 const {data:sessionData,error:sessionError}=await cloudClient.auth.getSession();
 if(sessionError||!sessionData.session?.access_token)throw new Error('Your One session is not ready. Sign in again.');
 const {data:config,error:configError}=await cloudClient.functions.invoke('one-push',{body:{action:'config'}});
 if(configError)throw configError;
 if(!config?.publicKey)throw new Error(config?.error||'Push server is not configured yet.');
 let subscription=await registration.pushManager.getSubscription();
 if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToBytes(config.publicKey)});
 const {error}=await cloudClient.functions.invoke('one-push',{body:{action:'subscribe',subscription:subscription.toJSON()}});
 if(error)throw error;
 const test=await cloudClient.functions.invoke('one-push',{body:{action:'test'}});
 if(test.error)console.warn("Operation failed; diagnostic details redacted.");
 return subscription;
}
async function checkTaskReminders(){
 let shown={};try{shown=JSON.parse(localStorage.getItem(taskReminderStorageKey())||'{}')}catch{}
 const now=Date.now(),notify=async(title,body,tag,taskId=null,type='reminder')=>{addAppNotification({title,body,tag,taskId,type});
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  const reg=await navigator.serviceWorker?.ready;
  const url=taskId?'./?open=task&id='+encodeURIComponent(taskId):'./?open=notifications';
  if(reg?.showNotification)await reg.showNotification(title,{body,icon:'./icons/student-brain.svg',tag,data:{url}});
  else new Notification(title,{body,tag});
 };
 const currentDate=today(),tomorrowDate=addDaysToDate(currentDate,1);
 for(const task of (data.tasks||[])){
  if(task.done||!task.due)continue;
  const snoozed=task.snoozedUntil?Date.parse(task.snoozedUntil):NaN,lead=Math.max(0,Number(task.notifyBeforeMinutes)||0)*60000;
  let occurrence=null,when=null;
  if(Number.isFinite(snoozed)){
   if(new Date(snoozed).toLocaleDateString('en-CA')!==currentDate||snoozed>now)continue;
   occurrence=reminderOccurrenceOn(task,currentDate)?currentDate:(reminderOccurrenceOn(task,tomorrowDate)?tomorrowDate:currentDate);when=snoozed;
  }else{
   occurrence=[currentDate,tomorrowDate].find(day=>reminderOccurrenceOn(task,day))||null;
   if(!occurrence)continue;
   const base=taskReminderDayTime({...task,due:occurrence});when=base-lead;
   if(new Date(when).toLocaleDateString('en-CA')!==currentDate)continue;
  }
  const key='task-'+task.id+'-'+occurrence+'-'+String(task.reminderTime||'09:00')+'-'+lead+(Number.isFinite(snoozed)?'-snooze-'+snoozed:'');
  if(!shown[key]&&when!==null&&now>=when&&now<when+24*60*60*1000){
   const linkedNote=(data.notes||[]).find(n=>n.id===task.relatedNoteId),linkedDoc=(data.documents||[]).find(d=>d.id===task.relatedDocumentId);
   const linkText=linkedNote?' · Note: '+(linkedNote.title||'Saved note'):linkedDoc?' · Document: '+(linkedDoc.name||'Saved document'):'';
   try{addAppNotification({title:'One · Task reminder',body:task.title+' · Due '+dateFmt(occurrence)+' at '+(task.reminderTime||'09:00')+linkText,type:'task',taskId:task.id,tag:key,relatedType:linkedNote?'note':linkedDoc?'document':null,relatedId:linkedNote?.id||linkedDoc?.id||null});
    if('Notification' in window&&Notification.permission==='granted'){const reg=await navigator.serviceWorker?.ready,url='./?open=task&id='+encodeURIComponent(task.id);if(reg?.showNotification)await reg.showNotification('One · Task reminder',{body:task.title+' is due '+(lead?'soon':'today')+'.'+linkText,icon:'./icons/student-brain.svg',tag:key,data:{url}});else new Notification('One · Task reminder',{body:task.title+' is due today.'})}
    shown[key]=true;
   }catch(err){console.warn("Operation failed; diagnostic details redacted.")}
  }
 }
 const todayDate=today();
 for(const doc of (data.documents||[])){
  if(!doc.expiresOn||!/^\d{4}-\d{2}-\d{2}$/.test(doc.expiresOn))continue;
  const expiryTime=new Date(doc.expiresOn+'T00:00:00').getTime(),days=Math.ceil((expiryTime-new Date(todayDate+'T00:00:00').getTime())/86400000);
  if(days<0)continue;
  const thresholds=Array.isArray(doc.expiryReminderDays)?doc.expiryReminderDays:[30,7,1,0];
  const threshold=thresholds.find(value=>days===Number(value));
  if(threshold===undefined)continue;
  const key='document-expiry-'+doc.id+'-'+doc.expiresOn+'-'+todayDate;
  if(shown[key])continue;
  try{await notify('One · Document expiry reminder',(doc.name||'A saved document')+(days===0?' expires today.':days===1?' expires tomorrow.':' expires in '+days+' days.')+' Review or renew it if needed.',key,null,'document');shown[key]=true}
  catch(error){console.warn("Operation failed; diagnostic details redacted.")}
 }
 const loanRows=(data.expenses||[]).filter(e=>['lent','borrowed'].includes(e.kind)&&e.dueDate&&e.dueDate<=today());
 for(const entry of loanRows){
  const group=(data.expenses||[]).filter(e=>e.person===entry.person&&((entry.kind==='lent'&&['lent','lent_repayment'].includes(e.kind))||(entry.kind==='borrowed'&&['borrowed','borrowed_repayment'].includes(e.kind))));
  const original=group.filter(e=>e.kind===entry.kind).reduce((n,e)=>n+Number(e.amount||0),0);
  const repaid=group.filter(e=>e.kind===(entry.kind==='lent'?'lent_repayment':'borrowed_repayment')).reduce((n,e)=>n+Number(e.amount||0),0);
  if(original-repaid<=0)continue;
  const key='loan-'+entry.id,last=Number(shown[key]||0),when=new Date(entry.dueDate+'T09:00:00').getTime();
  if(now<when||now-last<24*60*60*1000)continue;
  try{await notify('One · Udhaar repayment reminder',(entry.kind==='lent'?'Expected repayment from ':'Repayment due to ')+(entry.person||'Unknown')+' · '+money(entry.amount)+' · '+(entry.dueDate<today()?'Overdue since ':'Due today: ')+dateFmt(entry.dueDate),key,null,'money');shown[key]=now}
  catch(err){console.warn("Operation failed; diagnostic details redacted.")}
 }
 try{localStorage.setItem(taskReminderStorageKey(),JSON.stringify(shown))}catch(err){console.warn("Operation failed; diagnostic details redacted.")}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>checkTaskReminders());
else checkTaskReminders();
setInterval(checkTaskReminders,60000);window.addEventListener('focus',checkTaskReminders);
window.addEventListener('online',()=>{if(cloudReady&&cloudUser){if(cloudRetryTimer)clearTimeout(cloudRetryTimer);cloudRetryDelay=1500;queueCloudSave().then(()=>refreshCloudWorkspace(cloudUser?.id)).catch(error=>console.warn("Operation failed; diagnostic details redacted."))}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&navigator.onLine&&cloudReady&&cloudUser&&cloudMode!=='synced')queueCloudSave()});document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkTaskReminders()});

function speakVoiceConfirmation(message){if(typeof window.isStudentBrainVoiceRepliesOn!=='function'||!window.isStudentBrainVoiceRepliesOn()||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(message);u.lang='en-IN';window.speechSynthesis.speak(u)}


// Keep browser Back inside the app: return to the previous workspace page, not exit the app.
if(!history.state||!history.state.sbPage)history.replaceState({sbPage:'overview'},'',location.href);
window.addEventListener('popstate',e=>{page=e.state?.sbPage||'overview';render();});
render();
(function handlePwaShortcut(){
 const params=new URLSearchParams(location.search);
 if(params.get('quick-note')==='1'){
  history.replaceState({sbPage:'overview'},'',location.pathname);
  page='overview';render();
  requestAnimationFrame(()=>document.querySelector('#home-quick-note-form [name=content]')?.focus());
 }
 const requestedPage=params.get('open');
 if(requestedPage==='task'){const taskId=params.get('id');history.replaceState({sbPage:'planner'},'',location.pathname);page='planner';window.plannerView='All';render();requestAnimationFrame(()=>{const task=data.tasks.find(item=>item.id===taskId);if(task){const button=document.querySelector('[data-action="edit-task"][data-id="'+CSS.escape(taskId)+'"]');button?.scrollIntoView({behavior:'smooth',block:'center'});if(button)button.click();}});return}
 if(requestedPage==='notifications'){history.replaceState({sbPage:'overview'},'',location.pathname);page='overview';render();requestAnimationFrame(()=>action('open-notifications'));return}
 if(requestedPage==='loans'){
  history.replaceState({sbPage:'loans'},'',location.pathname);
  page='loans';render();
 }
})();
// Separate every signed-in account's workspace on this device. The old unscoped
// workspace is claimed once by the first account that signs in; later accounts
// start with their own empty workspace and never inherit another account's data.
let workspaceSwitchQueue=Promise.resolve();
function switchAccountWorkspace(user){
 const nextUserId=user?.id||null;
 workspaceSwitchQueue=workspaceSwitchQueue.catch(()=>{}).then(async()=>{
  if(nextUserId===activeWorkspaceUserId&&(!nextUserId||cloudReady))return;
  try{await workspaceWriteQueue;await syncQueue}catch(_){}
  stopWorkspaceRealtime();cloudReady=false;cloudUser=null;
  if(cloudRetryTimer)clearTimeout(cloudRetryTimer);
  activeWorkspaceUserId=nextUserId;
  activeWorkspaceKey=nextUserId?KEY+'-user-'+nextUserId:KEY+'-guest';
  lastSyncedAt=null;restoreSyncMeta(nextUserId);
  let saved=localStorage.getItem(activeWorkspaceKey);
  if(nextUserId&&!saved){
   let claimedBy=null;try{claimedBy=localStorage.getItem(LEGACY_OWNER_KEY)}catch(_){}
   const legacy=localStorage.getItem(KEY+'-guest')||localStorage.getItem(KEY);
   if(!claimedBy&&legacy&&confirm('This phone has older One data that was saved before account separation. Is this the account that originally owned that data? Choose OK to move a protected copy into this account, or Cancel if this is a different account.')){
    localStorage.setItem(KEY+'-legacy-recovery',legacy);
    localStorage.setItem(activeWorkspaceKey,legacy);
    localStorage.setItem(LEGACY_OWNER_KEY,nextUserId);
    saved=legacy;
   }
  }
  if(saved){
   try{data=migrateData(JSON.parse(saved))}catch(error){console.warn("Operation failed; diagnostic details redacted.");data=starter()}
  }else{data=starter();localStorage.setItem(activeWorkspaceKey,JSON.stringify(data))}
  await migrateWorkspaceToIndexedDB();
  render();
  if(nextUserId){
   try{await activateCloudWorkspace(nextUserId)}
   catch(error){console.warn("Operation failed; diagnostic details redacted.");cloudReady=false;cloudUser=null;setCloudMode('error','Saved locally. Cloud sync could not start: '+(error.message||'Unknown error'))}
  }else setCloudMode('offline','Guest data is saved only on this device. Sign in to sync across devices.');
  render();
 });
 return workspaceSwitchQueue;
}
window.OneWorkspace={purgeUserLocalData};
window.addEventListener('one:auth-changed',event=>{const user=event.detail?.user||null;if(user)switchAccountWorkspace(user).then(()=>consumeOneShareInbox())});
initCloud();
requestWorkspaceStoragePersistence();

document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.querySelector('.create-radial-menu'))closeQuickAddMenu();else if(document.querySelector('.modal-backdrop'))action('close-modal')}});
