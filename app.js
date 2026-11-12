const KEY='student-brain-data-v1';
let activeWorkspaceUserId=null;
let activeWorkspaceKey=KEY+'-guest';
const LEGACY_OWNER_KEY=KEY+'-legacy-claimed-by';
function workspaceStorageKey(){return activeWorkspaceKey;}
function workspaceIndexedDBKey(){return 'workspace:'+activeWorkspaceKey;}
const DATA_SCHEMA_VERSION=2;
const starter=()=>({schemaVersion:DATA_SCHEMA_VERSION,notes:[],tasks:[],projects:[],expenses:[],moneyBudgets:[],messages:[],studySessions:[],documents:[],memories:[]});
function migrateData(raw){
 const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const next={...starter(),...source};
 for(const key of ['notes','tasks','projects','expenses','moneyBudgets','messages','studySessions','documents','memories'])if(!Array.isArray(next[key]))next[key]=[];
 next.schemaVersion=DATA_SCHEMA_VERSION;
 return next;
}
try{if(!localStorage.getItem(LEGACY_OWNER_KEY)&&!localStorage.getItem(KEY+'-guest')&&localStorage.getItem(KEY))localStorage.setItem(KEY+'-guest',localStorage.getItem(KEY))}catch(error){console.warn('Could not prepare guest workspace migration',error)}
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
  const result=await client.auth.signInAnonymously();
  if(result.error){
   if(/anonymous|disabled|not enabled|captcha/i.test(result.error.message||''))throw new Error('Supabase Anonymous Sign-Ins are not enabled. Open Supabase → Authentication → Sign In / Providers → Anonymous Sign-Ins, enable it, then retry.');
   throw result.error;
  }
  const token=result.data.session?.access_token;
  if(!token)throw new Error('Supabase did not create an AI session. Refresh and retry.');
  return token;
 })();
 try{return await studentBrainAITokenPromise}finally{studentBrainAITokenPromise=null}
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
 try{const db=await openAIFileDB();await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}catch(err){console.warn('Could not remove local original file',err)}
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
  console.warn('IndexedDB migration unavailable; localStorage remains active',err);
  window.studentBrainStorageHealth={state:'warning',message:err.message||'IndexedDB unavailable'};
 }
}
async function requestWorkspaceStoragePersistence(){
 try{
  if(navigator.storage?.persist)window.studentBrainStoragePersistent=await navigator.storage.persist();
  if(navigator.storage?.estimate)window.studentBrainStorageEstimate=await navigator.storage.estimate();
 }catch(err){console.info('Storage persistence/estimate not available',err)}
}
function loadData(){
 try{return migrateData(JSON.parse(localStorage.getItem(workspaceStorageKey())||'{}'))}
 catch(primaryError){
  try{const lastGood=localStorage.getItem(workspaceStorageKey()+'-last-good');if(lastGood){console.warn('Primary workspace data was unreadable; recovered the last-good local snapshot.');return migrateData(JSON.parse(lastGood))}}
  catch(recoveryError){console.error('Last-good workspace recovery failed',recoveryError)}
  console.error('Workspace data could not be loaded',primaryError);return starter();
 }
}
let syncQueue=Promise.resolve();
let cloudRetryTimer=null,cloudRetryDelay=1500,lastSyncedAt=null,cloudMode='offline',cloudLastError='';
function cloudStatus(message){
 const el=document.querySelector('#cloud-status');
 if(el){
  const label=cloudMode==='synced'?'Synced':cloudMode==='offline'?'Offline':cloudMode==='error'?'Sync issue':cloudMode==='syncing'?'Syncing…':cloudMode==='loading'?'Restoring…':'Saved locally';
  const time=lastSyncedAt?' · '+new Date(lastSyncedAt).toLocaleString():'';
  el.textContent=label+time;
  el.title=cloudLastError||message||'Signed-in workspaces sync securely across devices. Guest data stays on this device.';
  el.dataset.state=cloudMode;
 }
}
function setCloudMode(mode,error=''){cloudMode=mode;cloudLastError=error;cloudStatus()}
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
  console.error('Local save failed',err);
  setCloudMode('error',err.message);
  toast('Local save failed. Export a backup and free storage.');
 }
 saveWorkspaceSnapshot(data).catch(err=>{
  console.warn('IndexedDB workspace safety copy failed',err);
  window.studentBrainStorageHealth={state:'warning',message:err.message||'IndexedDB copy failed'};
 });
 if(cloudReady&&cloudUser)queueCloudSave();
}
function queueCloudSave(){
 if(!cloudReady||!cloudUser||!cloudClient)return Promise.resolve();
 const ownerId=cloudUser.id,snapshot=JSON.parse(JSON.stringify(data));
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
  setCloudMode('synced');
 }catch(err){
  console.error('Cloud sync failed',err);
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
  console.error('Could not refresh cloud workspace',error);
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
   writeLocalWorkspace(data).then(()=>render()).catch(error=>console.warn('Could not store remote workspace locally',error));
   if(JSON.stringify(merged)!==remoteText)queueCloudSave();
   else{lastSyncedAt=payload.new.updated_at||new Date().toISOString();setCloudMode('synced')}
  }).subscribe(status=>{
   if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Live workspace updates unavailable; refresh-on-focus remains enabled.');
  });
}
async function activateCloudWorkspace(userId){
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
 }catch(error){console.error('Cloud sync initialization failed',error);setCloudMode('error',error.message)}
}
window.addEventListener('online',()=>{if(cloudReady&&cloudUser)refreshCloudWorkspace(cloudUser.id)});
window.addEventListener('focus',()=>{if(cloudReady&&cloudUser)refreshCloudWorkspace(cloudUser.id)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cloudReady&&cloudUser)refreshCloudWorkspace(cloudUser.id)});


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
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function toast(msg){const t=document.querySelector('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove('show'),2300)}
function empty(msg,icon='✧'){return `<div class="empty"><div class="empty-symbol">${icon}</div>${esc(msg)}</div>`}
function backHomeButton(){return '<button type="button" class="back-home-icon" data-page="overview" aria-label="Back to Home" title="Back to Home">←</button>'}
function titleBlock(kicker,title,sub,button=''){return `<div class="row" style="align-items:flex-start"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${button}</div>`}
function btn(label,action,primary=false,small=false){return `<button class="btn ${primary?'primary':''} ${small?'small':''}" data-action="${action}">${label}</button>`}
function stat(label,num,note,icon,target){return `<div class="card stat-card" ${target?`data-page="${target}" role="button" tabindex="0" title="Open ${esc(label)}"`:''}><div class="row"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${num}</div><div class="stat-note">${note}${target?'<span class="stat-open-hint"> · View details →</span>':''}</div></div>`}
function taskRow(t){const completedLabel=t.done?(t.completedAt?`Completed · ${new Date(t.completedAt).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'})}`:'Completed · time not recorded') : '';const overdue=!t.done&&t.due&&t.due<today(),dueLabel=t.due?(overdue?'Overdue · ':'Due · ')+dateFmt(t.due):'No due date';return `<div class="list-item planner-task ${overdue?'is-overdue':''} ${t.done?'is-complete':''}"><button type='button' class='planner-check-circle ${t.done?"checked":""}' data-action='toggle-task' data-id='${t.id}' aria-label='${t.done?"Mark incomplete":"Mark complete"}' title='${t.done?"Mark incomplete":"Mark complete"}'>${t.done?"✓":""}</button><button type="button" class="planner-task-open" data-action="edit-task" data-id="${t.id}" aria-label="Open task details for ${esc(t.title)}"><span class="list-copy"><b class="${t.done?'task-done':''}">${esc(t.title)}</b><small class="task-meta"><span class="task-category">${esc(t.category||'General')}</span><span class="task-meta-separator"> · </span><span class="task-due">${dueLabel}</span>${t.done?`<span class="task-completed-at"> · ${esc(completedLabel)}</span>`:''}</small>${t.notes&&String(t.notes).trim()?`<span class="task-notes">${esc(String(t.notes).trim())}</span>`:'<span class="task-notes task-notes-empty">No notes added</span>'}</span></button><button class="task-complete-action ${t.done?'checked':''}" type="button" data-action="toggle-task" data-id="${t.id}" title="${t.done?'Mark incomplete':'Mark complete'}" aria-label="${t.done?'Mark incomplete':'Mark complete'}">${t.done?'✓':'Complete'}</button></div>`;}function noteRow(n){return `<div class="list-item"><div class="list-icon">▤</div><div class="list-copy"><b>${esc(n.title)}</b><small>${esc(n.subject||'General')} · ${new Date(n.updated).toLocaleDateString('en-IN')}</small></div><button class="btn small" data-action="edit-note" data-id="${n.id}">Open</button></div>`}
function projectCard(p){const tasks=data.tasks.filter(t=>t.projectId===p.id),done=tasks.filter(t=>t.done).length;return `<div class="card"><div class="row"><span class="stat-icon">▣</span><span class="tag ${p.status==='Completed'?'green':'blue'}">${esc(p.status||'In progress')}</span></div><h3 style="margin-top:17px">${esc(p.name)}</h3><p class="muted" style="font-size:12px;line-height:1.6;min-height:38px">${esc(p.description||'No description yet.')}</p><div class="row"><small class="muted">${tasks.length} tasks · ${dateFmt(p.targetDate)}</small><button class="btn small" data-action="edit-project" data-id="${p.id}">Edit</button></div>${tasks.length?`<div class="progress"><span style="width:${Math.round(done/tasks.length*100)}%"></span></div>`:''}</div>`}
function scrollChatToBottom(){const chat=document.querySelector('#chat-messages');if(!chat)return;const scroll=()=>{chat.scrollTop=chat.scrollHeight;const last=chat.lastElementChild;if(last)last.scrollIntoView({block:'end',behavior:'auto'});};scroll();requestAnimationFrame(()=>requestAnimationFrame(scroll));}
function render(){try{document.body.classList.toggle('home-page',page==='overview');document.body.classList.toggle('has-page-back',page!=='overview'&&page!=='ask');document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));let c=document.querySelector('#page-content');if(!c)throw Error('Main page container is missing');const pages={overview,ask,knowledge,uploads:uploadedItems,notes:notesOnly,planner,tasks,study:studyPlanner,backup:backupRestore,projects,expenses,loans:()=>{window.moneyTab='udhaar';return expenses()},settings,memory:personalMemory,analytics:()=>window.OneAnalytics?.dashboardHTML()||'<section class="card">Analytics is loading…</section>'};c.innerHTML=(pages[page]||overview)();if(window.OneAnalytics)window.OneAnalytics.trackPage(page);if(page!=='overview'&&page!=='ask')c.insertAdjacentHTML('afterbegin',backHomeButton());if(page==='ask')scrollChatToBottom();document.querySelector('.mobile-nav')?.remove();document.querySelector('.floating-create-button')?.remove();if(page==='overview'){const fab=document.createElement('button');fab.className='floating-create-button';fab.type='button';fab.dataset.action='open-quick-add';fab.setAttribute('aria-label','Create new item');fab.innerHTML='<span aria-hidden="true">＋</span> Create';document.body.appendChild(fab)}}catch(err){console.error('Student Brain render failed',err);const c=document.querySelector('#page-content');if(c)c.innerHTML='<section class="card"><h2>Workspace could not load</h2><p>Refresh the page. If this continues, export your backup before clearing browser data, then share the browser console error.</p><small></small></section>';const msg=document.querySelector('#page-content small');if(msg)msg.textContent=String(err?.message||err)}}
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
function overview(){
 const open=data.tasks.filter(t=>!t.done),todayTasks=open.filter(t=>t.due===today()),due=open.filter(t=>t.due&&t.due>today()).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,3),month=today().slice(0,7),spend=data.expenses.filter(e=>(e.kind||'expense')==='expense'&&e.date?.startsWith(month)).reduce((s,e)=>s+Number(e.amount||0),0);
 const week=smartWeekSummary(),projects=smartProjectProgress(),loansDue=upcomingUdhaar(),overdueTasks=open.filter(t=>t.due&&t.due<today()).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,3);
 return `<div class="home-dashboard">
  <div class="home-greeting"><div class="eyebrow">YOUR PERSONAL WORKSPACE</div><h1>Good to see you again</h1><p class="subtitle">Your life, work, and goals—organized in one place.</p></div>
  <section class="home-hero">
   <div class="home-hero-meta"><span class="eyebrow">✦ ASK ONE</span><span class="home-hero-powered">Your personal AI assistant</span></div>
   <h2>What can I help you with?</h2>
   <form class="home-brain-search" id="home-brain-search"><span class="home-search-symbol" aria-hidden="true">⌕</span><input id="home-brain-query" aria-label="Ask One" placeholder="Ask One anything…" autocomplete="off"><button class="home-mic-button" type="button" data-action="voice-quick-command" aria-label="Start voice assistant" title="Speak to One"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"></path></svg></button><button class="home-chat-open" type="button" data-page="ask" aria-label="Open chat history" title="Open chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3.4A7.5 7.5 0 1 1 20 11.5Z"></path><path d="M8 11h8M8 14h5"></path></svg></button></form>
   <div class="home-prompts"><span>Try:</span><button type="button" data-question="Summarize today's priorities">Summarize today's priority</button><button type="button" data-question="Track an expense">Track expense</button><button type="button" data-question="Draft a note">Draft note</button></div>
  </section>
  <div class="grid stats home-stats">${stat('Open tasks',open.length,'Tasks & deadlines','◷','planner')}${stat('Uploaded items',(data.documents||[]).length,'PDFs & images','↥','uploads')}${stat('Notes',data.notes.length,'Written notes','▤','notes')}${stat('Money',money(spend),'Spent this month','₹','expenses')}</div>
  <section class="card quick-note-widget"><div class="row"><div><div class="eyebrow">QUICK CAPTURE</div><h2>Save a note instantly</h2><p class="muted">A thought, reminder or idea — saved to your One notes.</p></div><span class="quick-note-icon">✎</span></div><form id="home-quick-note-form"><input name="title" aria-label="Note title" placeholder="Title (optional)"><textarea name="content" aria-label="Quick note" placeholder="Write something to remember…" required rows="3"></textarea><div class="row"><small class="muted">♙ Private to your One workspace</small><button class="btn primary" type="submit">Save note ↗</button></div></form></section>
  <section class="card home-today"><div class="home-section-heading"><div class="row"><h2>Today</h2><span class="tag">${todayTasks.length} due</span></div><button class="home-section-icon" type="button" data-page="planner" aria-label="Open task planner" title="Open task planner">☷</button></div><div class="list">${todayTasks.length?todayTasks.map(taskRow).join(''):`${empty('Nothing due today. Add your first task, or ask One to capture it.','☑')}${btn('+ Add your first task','new-task',true)}`}</div></section>
  <section class="card home-coming-up"><div class="home-section-heading"><h2>Coming up</h2>${btn('View all →','go-planner',false,true)}</div><div class="list">${due.length?due.map(taskRow).join(''):empty('No upcoming tasks yet. Add a task with a due date.','▦')}</div></section>
  <section class="grid smart-insights-grid">
   <article class="card smart-insight-card"><div class="eyebrow">LAST 7 DAYS</div><h2>Weekly review</h2><div class="smart-metric-grid"><div><small>Spent</small><b>${money(week.spent)}</b></div><div><small>Income</small><b>${money(week.income)}</b></div><div><small>Tasks done</small><b>${week.completed}</b></div><div><small>Overdue</small><b>${week.overdue}</b></div></div><p class="muted">From ${dateFmt(week.start)} to ${dateFmt(week.end)} · Net ${money(week.income-week.spent)}</p><button class="btn small" type="button" data-action="go-money-reports">Open money reports</button></article>
   <article class="card smart-insight-card"><div class="eyebrow">PAYMENTS & REPAYMENTS</div><h2>Udhaar due soon</h2><div class="list">${loansDue.length?loansDue.map(item=>'<div class="list-item"><div class="list-copy"><b>'+esc(item.person||'Unknown')+'</b><small>'+(item.kind==='lent'?'Expected back':'You need to repay')+' · '+dateFmt(item.dueDate)+'</small></div><b>'+money(item.amount)+'</b></div>').join(''):empty('No repayments due in the next 7 days.','₹')}</div><button class="btn small" type="button" data-action="go-udhaar">Open Udhaar tracker</button></article>
   <article class="card smart-insight-card"><div class="eyebrow">ACTIVE WORK</div><h2>Project progress</h2><div class="list">${projects.length?projects.map(item=>'<div class="smart-project-row"><div class="row"><b>'+esc(item.project.name||'Untitled project')+'</b><small>'+item.done+'/'+item.total+' tasks</small></div><div class="progress"><span style="width:'+item.percent+'%"></span></div><small class="muted">'+(item.total?item.percent+'% complete':(item.project.targetDate?'Target '+dateFmt(item.project.targetDate):'No linked tasks yet'))+'</small></div>').join(''):empty('No active projects. Create a project to track progress.','▣')}</div><button class="btn small" type="button" data-page="projects">Open projects</button></article>
  </section>
  <section class="card smart-briefing"><div class="row"><div><div class="eyebrow">ONE INTELLIGENCE</div><h2>Daily briefing</h2><p class="muted">Your next actions, deadlines and repayment heads-up.</p></div><span class="tag blue">${overdueTasks.length+loansDue.filter(x=>x.dueDate<today()).length} need attention</span></div><div class="smart-briefing-list">${overdueTasks.length?overdueTasks.map(t=>'<div class="smart-briefing-item"><span class="tag red">Overdue</span><b>'+esc(t.title)+'</b><small>'+dateFmt(t.due)+'</small></div>').join(''):''}${loansDue.length?loansDue.map(e=>'<div class="smart-briefing-item"><span class="tag '+(e.dueDate<today()?'red':'blue')+'">'+(e.dueDate<today()?'Overdue':'Udhaar')+'</span><b>'+esc(e.person||'Unknown')+'</b><small>'+dateFmt(e.dueDate)+'</small></div>').join(''):''}${!overdueTasks.length&&!loansDue.length?'<p class="muted">You are clear for now. Keep your upcoming tasks up to date.</p>':''}</div><div class="row smart-briefing-actions"><button class="btn small" type="button" data-action="enable-reminders">Enable notifications</button><small class="muted">Works when One is open or reopened</small></div></section>
 </div>`;
}
function documentsCards(){return `<div class="grid item-grid document-grid">${(data.documents||[]).length?(data.documents||[]).map(d=>`<article class="card document-card"><div class="row"><span class="tag blue">${d.type==='pdf'?'PDF':'Image'}</span><button class="btn small" data-action="ask-document" data-id="${d.id}">Ask AI</button><button class="btn small primary" data-action="convert-document-json" data-id="${d.id}">Convert to JSON</button><button class="btn small" data-action="retry-document-ocr" data-id="${d.id}">Re-upload / OCR</button><button class="btn small danger" data-action="delete-document" data-id="${d.id}">Delete</button></div><h3>${esc(d.name)}</h3><p class="muted">${esc(d.extractedText?.length||0)} characters extracted · ${new Date(d.created).toLocaleDateString('en-IN')}</p><small class="muted">${esc(d.jsonStatus==='saved_to_knowledge'?'Saved to Knowledge Base':d.jsonStatus==='processing'?'Converting to JSON…':d.jsonStatus==='error'?'Conversion failed: '+(d.jsonError||'Try again'):d.jsonStatus||"Text extracted")}</small>${d.extractedJson?`<details open><summary>Generated JSON · ${esc(d.extractedJson.document_type||"document")}</summary><pre class="json-preview">${esc(JSON.stringify(d.extractedJson,null,2))}</pre><div class="actions"><button class="btn small" data-action="copy-document-json" data-id="${d.id}">Copy JSON</button><button class="btn small" data-action="download-document-json" data-id="${d.id}">Download JSON</button><button class="btn small" data-action="save-document-json" data-id="${d.id}">Save to Knowledge Base</button></div></details>`:""}<details><summary>View extracted text</summary><p class="document-extract">${esc((d.extractedText||'').slice(0,4500))}${(d.extractedText||'').length>4500?'…':''}</p></details></article>`).join(''):`<div class="card" style="grid-column:1/-1">${empty('Your uploaded notices and date sheets will appear here.','📄')}</div>`}</div>`}
function knowledge(){return `${titleBlock('YOUR KNOWLEDGE','My Knowledge','Save notes, upload exam date sheets and ask questions from your files.',btn('+ New note','new-note',true))}<div class="card document-upload-card"><div><h2>Upload a notice or date sheet</h2><p class="muted">Upload a PDF or image. After extraction, ask about it from the main Ask My Brain page.</p></div><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary upload-label" for="document-upload">＋ Upload PDF / image</label><button class="btn" data-action="go-ask">Ask My Brain ↗</button></div><input id="document-upload" type="file" accept=".pdf,.png,.jpg,.jpeg" multiple hidden><small id="document-upload-status" class="muted">PDF and image files · max 12 MB each</small></div>${documentsCards()}<div class="toolbar"><input class="search" id="note-search" placeholder="Search notes, subjects, tags…" value="${esc(window.noteQuery||'')}"><select id="subject-filter" class="search" style="max-width:190px"><option value="">All subjects</option>${[...new Set(data.notes.map(n=>n.subject).filter(Boolean))].map(s=>`<option ${window.subjectFilter===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="notes-list" class="grid item-grid">${notesCards()}</div><p class="muted" style="font-size:11px;margin-top:18px">MVP note: notes are saved in your current browser, not synced to an online account.</p>`}
function uploadedItems(){return `${titleBlock('YOUR LIBRARY','Uploaded Items','PDFs and images you have uploaded to your knowledge base.',btn('Ask My Brain ↗','go-ask',true))}<div class="card document-upload-card"><div><h2>Upload a notice or date sheet</h2><p class="muted">Upload a PDF or image. After extraction, ask about it from the main Ask My Brain page.</p></div><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary upload-label" for="document-upload">＋ Upload PDF / image</label><button class="btn" data-action="go-ask">Ask My Brain ↗</button></div><input id="document-upload" type="file" accept=".pdf,.png,.jpg,.jpeg" multiple hidden><small id="document-upload-status" class="muted">PDF and image files · max 12 MB each</small></div>${documentsCards()}`}
function notesOnly(){return `${titleBlock('YOUR NOTES','Note','Your saved notes in one place. Uploaded PDFs and images are kept under Uploaded Items.',btn('+ New note','new-note',true))}<div class="toolbar"><input class="search" id="note-search" placeholder="Search notes, subjects, tags…" value="${esc(window.noteQuery||'')}"><select id="subject-filter" class="search" style="max-width:190px"><option value="">All subjects</option>${[...new Set(data.notes.map(n=>n.subject).filter(Boolean))].map(s=>`<option ${window.subjectFilter===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="notes-list" class="grid item-grid">${notesCards()}</div><p class="muted" style="font-size:11px;margin-top:18px">Notes are saved in your current browser.</p>`}
function notesCards(){let q=(window.noteQuery||'').toLowerCase(),s=window.subjectFilter||'';let ns=[...data.notes].filter(n=>(!s||n.subject===s)&&(!q||[n.title,n.content,n.subject,n.tags].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.updated-a.updated);if(!ns.length)return `<div class="card" style="grid-column:1/-1">${empty(q?'No notes match your search.':'No notes yet. Try an example: “Remember my project idea is a campus event app.” Add your first note to keep it here.','▤')}${btn('+ Create a note','new-note',true)}</div>`;return ns.map(n=>`<article class="card note-card"><div class="row"><span class="tag blue">${esc(n.subject||'General')}</span><button class="btn small" data-action="edit-note" data-id="${n.id}">Edit</button></div><div class="note-title" style="margin-top:15px">${esc(n.title)}</div><p>${esc(n.content)}</p>${n.attachmentData?`<div class="row" style="margin:8px 0"><small class="muted">📎 ${esc(n.attachmentName||'Attached file')}</small><a class="btn small" href="${n.attachmentData}" download="${esc(n.attachmentName||'attachment')}">Download</a></div>`:''}<div class="row"><small class="muted">${esc(n.tags||'No tags')}</small><button class="btn small danger" data-action="delete-note" data-id="${n.id}">Delete</button></div></article>`).join('')}
function tasks(){const current=today(),monthStart=new Date(current.slice(0,7)+'-01T00:00:00'),daysInMonth=new Date(monthStart.getFullYear(),monthStart.getMonth()+1,0).getDate(),calendarTasks=(data.tasks||[]).filter(t=>t.due),calendar=Array.from({length:daysInMonth},(_,i)=>{const date=current.slice(0,7)+'-'+String(i+1).padStart(2,'0'),items=calendarTasks.filter(t=>t.due===date);return `<div class="planner-calendar-day ${date===current?'is-today':''}"><b>${i+1}</b>${items.slice(0,3).map(t=>`<button type="button" class="calendar-task ${t.done?'done':''}" data-action="edit-task" data-id="${t.id}" title="Open task: ${esc(t.title)}">${esc(t.title)}</button>`).join('')}${items.length>3?`<small>+${items.length-3} more</small>`:''}</div>`}).join(''),calendarSection=`<section class="planner-calendar-wrap card"><div class="row"><div><div class="eyebrow">MONTH AT A GLANCE</div><h2>${monthStart.toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</h2></div><span class="muted">Tap a task to open it</span></div><div class="planner-calendar-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="planner-calendar-weekday">${d}</div>`).join('')}${Array.from({length:(monthStart.getDay()+6)%7},()=>'<div class="planner-calendar-day is-blank"></div>').join('')}${calendar}</div></section>`;const all=[...(data.tasks||[])].sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;return (a.due||'9999').localeCompare(b.due||'9999')});const open=all.filter(t=>!t.done),done=all.filter(t=>t.done),expanded=window.taskSectionExpanded||'open';const renderGroup=(title,items,key)=>`<section class="card task-accordion"><button class="row task-section-toggle" type="button" data-action="toggle-task-section" data-id="${key}" aria-expanded="${expanded===key}" style="width:100%;border:0;background:transparent;text-align:left;cursor:pointer;padding:0"><h2>${title}</h2><span class="muted">${items.length}</span><span aria-hidden="true">${expanded===key?'▾':'▸'}</span></button>${expanded===key?`<div class="list" style="margin-top:14px">${items.length?items.map(t=>`${taskRow(t)}<div class="task-row-actions"><button class="btn small" data-action="share-task-whatsapp" data-id="${t.id}">WhatsApp</button><button class="btn small" data-action="share-task-telegram" data-id="${t.id}">Telegram</button><button class="btn small" data-action="edit-task" data-id="${t.id}">Edit</button> <button class="btn small danger" data-action="delete-task" data-id="${t.id}">Delete</button></div>`).join(''):empty('Nothing here yet. Add a task with a due date.','☑')}</div>`:''}</section>`;return `${titleBlock('YOUR TASKS','Tasks','See your tasks directly, with due dates and quick actions.',btn('+ Add task','new-task',true)+btn('Reminders','enable-reminders',false,true))}<div class="planner-summary"><div><b>${open.length}</b><span>Open tasks</span></div><div class="overdue-summary"><b>${open.filter(t=>t.due&&t.due<today()).length}</b><span>Overdue</span></div><div><b>${done.length}</b><span>Completed</span></div></div>${renderGroup('Open tasks',open,'open')}${renderGroup('Completed',done,'completed')}${calendarSection}</div>`;}function planner(){
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
 const monthKey=window.plannerMonth||now.slice(0,7),parts=monthKey.split('-').map(Number),monthStart=new Date(parts[0],parts[1]-1,1),daysInMonth=new Date(parts[0],parts[1],0).getDate(),offset=(monthStart.getDay()+6)%7;
 const monthTasks=all.filter(t=>t.due&&t.due.startsWith(monthKey));
 const calendar=Array.from({length:42},(_,i)=>{const day=i-offset+1;if(day<1||day>daysInMonth)return '<div class="planner-calendar-day is-blank"></div>';const date=monthKey+'-'+String(day).padStart(2,'0'),items=monthTasks.filter(t=>t.due===date);return '<button type="button" class="planner-calendar-day '+(date===now?'is-today ':'')+(date===window.plannerSelectedDate?'is-selected':'')+'" data-action="planner-date" data-id="'+date+'"><span class="calendar-day-number">'+day+'</span>'+(items.length?'<span class="calendar-task-count">'+items.length+'</span>':'')+'</button>'}).join('');
 const monthLabel=monthStart.toLocaleDateString('en-IN',{month:'long',year:'numeric'}),tabs=['Today','Tomorrow','Upcoming','Overdue','All','Completed'];
 return '<div class="daily-planner-redesign"><div class="daily-planner-topbar">'+btn('♧ Reminders','enable-reminders',false,true)+'</div><div class="daily-planner-heading"><div class="eyebrow">'+dateLabel+'</div><h1>Daily planner</h1></div><section class="daily-progress-card"><div class="daily-progress-copy"><div><b>'+doneCount+' of '+total+'</b><strong>completed</strong></div><span>'+(open.length?'Next: '+esc([...open].filter(t=>t.due).sort((a,b)=>a.due.localeCompare(b.due))[0]?.title||'Open task'):'All tasks completed')+'</span></div><div class="daily-progress-track"><i style="width:'+progress+'%"></i></div><div class="daily-mini-stats"><button data-action="planner-view" data-id="All" aria-label="Show all open tasks"><b>'+open.length+'</b><span>Open</span></button><button class="is-overdue" data-action="planner-view" data-id="Overdue"><b>'+overdue.length+'</b><span>Overdue</span></button><button class="is-done" data-action="planner-view" data-id="Completed"><b>'+doneCount+'</b><span>Done</span></button></div></section><div class="daily-planner-content">'+content+'</div><div class="planner-tabs daily-filter-tabs" role="tablist" aria-label="Task views">'+tabs.map(x=>'<button class="planner-tab '+(view===x?'active':'')+'" data-action="planner-view" data-id="'+x+'" role="tab" aria-selected="'+(view===x)+'">'+x+'</button>').join('')+'</div><section class="planner-calendar-wrap daily-calendar"><div class="planner-calendar-heading"><div><div class="eyebrow">MONTH AT A GLANCE</div><h2>'+monthLabel+'</h2><p>'+monthTasks.length+' scheduled · '+monthTasks.filter(t=>!t.done).length+' still open</p></div><div class="planner-calendar-controls"><button data-action="planner-month" data-id="prev">‹</button><button class="calendar-today-button" data-action="planner-month" data-id="today">Today</button><button data-action="planner-month" data-id="next">›</button></div></div><div class="planner-calendar-grid">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>'<div class="planner-calendar-weekday">'+d+'</div>').join('')+calendar+'</div></section><button class="daily-floating-add" data-action="new-task">＋ <span>Add task</span></button></div>';
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
}function ask(){const hasMessages=data.messages.length>0;return `<section class="chat-shell ${hasMessages?"has-messages":"is-empty"}" aria-label="Ask One chat"><header class="chat-intro"><button type="button" class="chat-back" data-page="overview" aria-label="Back to Today" title="Back to Today">←</button><div class="chat-brand-mark" aria-hidden="true">✦</div><div class="chat-intro-copy"><div class="eyebrow">YOUR PERSONAL ASSISTANT</div><h2>Ask One</h2><p>Ask about your saved notes, files, tasks, projects and money.</p></div><span class="chat-context-pill"><span aria-hidden="true">●</span> Saved context</span></header>${!hasMessages?`<div class="chat-welcome"><p>What would you like to know?</p><div class="suggestions"><button class="suggestion" data-question="Summarize my notes">Summarize my notes</button><button class="suggestion" data-question="What subjects have I saved?">My saved subjects</button><button class="suggestion" data-question="What should I work on next?">What should I work on next?</button><button class="suggestion" data-question="Who owes me money?">Who owes me money?</button><button class="suggestion" data-question="How much do I owe others?">How much do I owe others?</button></div></div>`:``}<div class="chat-messages" id="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">${data.messages.map((m,i)=>`<article class="chat-message-row ${m.role==='user'?'from-user':'from-one'}"><div class="bubble ${m.role==='user'?'user':'assistant'}"><div class="bubble-content">${formatChatText(m.content)}</div>${m.sources?.length?`<span class="source">Sources: ${m.sources.map(esc).join(', ')}</span>`:``}</div></article>`).join('')}</div>${chatBusy?'<div class="bubble assistant typing-indicator" role="status" aria-live="polite"><span>One is thinking</span><span class="typing-dots" aria-hidden="true"> ···</span></div>':''}<form class="chat-form" id="chat-form"><input id="chat-input" aria-label="Message One" placeholder="Message One…" autocomplete="off"><button class="btn primary chat-send" type="submit" ${chatBusy?'disabled':''}><span>${chatBusy?'Thinking…':'Send'}</span><span aria-hidden="true">↗</span></button></form><div class="chat-note">Your message and relevant saved passages may be sent to Google Gemini to generate a reply. Google free-tier content may be used to improve Google products. Avoid sharing sensitive information and verify important answers with original sources.</div></section>`}
function personalMemory(){const memories=data.memories||[];return `${titleBlock('PERSONAL MEMORY','Personal memory','Save preferences and useful facts. Ask One can use them alongside your notes and saved documents.',btn('+ Add memory','new-memory',true))}<div class="card memory-explainer"><h2>Your personal memory, under your control</h2><p class="muted">Examples: preferred language, learning style, course goals, formatting preferences, or recurring context. Only add details you want saved in this browser.</p></div><div class="grid item-grid">${memories.length?memories.map(m=>`<article class="card memory-card"><div class="row"><span class="tag blue">${esc(m.category||'Preference')}</span><button class="btn small" data-action="edit-memory" data-id="${m.id}">Edit</button></div><h3>${esc(m.title)}</h3><p>${esc(m.content)}</p><div class="row"><small class="muted">Saved ${dateFmt(m.date||today())}</small><button class="btn small danger" data-action="delete-memory" data-id="${m.id}">Delete</button></div></article>`).join(''):`<div class="card" style="grid-column:1/-1">${empty('No personal memories yet. Add a preference or useful fact to help One tailor its answers.','✧')}</div>`}</div><p class="muted" style="font-size:11px;margin-top:15px">Memory is stored locally on this device and included in your workspace backup.</p>`}
function settings(){return `${titleBlock('PROFILE & PREFERENCES','Settings','Manage your One account, companion app and data safety.')}<div class="card android-companion-card"><div class="row"><div class="list-icon">📱</div><div class="list-copy"><b>One SMS Sync for Android</b><small>Floating One bubble · Quick Notes · UPI SMS capture</small></div><span class="tag green">Available</span></div><p class="muted" style="font-size:12px;line-height:1.7;margin:12px 0">Install the companion app on your Android phone and sign in using the same One account. Enable the floating bubble or optional UPI SMS access from inside the app.</p><div class="actions"><a class="btn primary" href="https://github.com/Arbaj-k/one/releases/download/one-sms-sync-v0.1.0/app-debug.apk" target="_blank" rel="noopener">Download Android APK ↓</a><a class="btn" href="https://github.com/Arbaj-k/one/releases/tag/one-sms-sync-v0.1.0" target="_blank" rel="noopener">Release notes</a></div><small class="muted">Initial debug-signed release. Android may ask you to confirm installation from this source.</small></div><section class="card reminder-connections-card"><div class="row"><div class="list-copy"><h2>Reminders &amp; connected apps</h2><small>Browser alerts are available. WhatsApp and Telegram task sharing is ready from the Tasks list.</small></div><span class="tag amber">Auto delivery not connected</span></div><p class="muted" style="font-size:12px;line-height:1.7">To send scheduled messages automatically, One needs a Telegram bot connection and WhatsApp Business Cloud API credentials. These must be stored securely on the backend, never in the browser.</p><div class="actions"><button class="btn primary" type="button" data-action="enable-reminders">Enable browser reminders</button><span class="muted" style="font-size:12px">WhatsApp / Telegram: use the share buttons on any task.</span></div></section><div class="grid two-col"><div class="card"><h2>Workspace</h2><div class="list-item"><div class="list-icon">✦</div><div class="list-copy"><b>Student Brain</b><small>Personal workspace</small></div><span class="tag green">Ready</span></div><p class="muted" style="font-size:12px;line-height:1.7;margin-top:15px">Your data is stored in this browser. Export regular backups to keep a copy.</p></div><div class="card"><h2>Data controls</h2><p class="muted" style="font-size:12px;line-height:1.7">Download a backup before clearing local data.</p><div class="actions">${btn('Export my data ↓','export-data',true)}${btn('Clear all data','clear-data')}</div></div></div>`}function modal(title,body,saveLabel='Save'){const fab=document.querySelector('.floating-create-button');fab?.classList.add('is-hidden');document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal create-form-screen" role="dialog" aria-modal="true" aria-labelledby="edit-form-title"><div class="modal-head"><button type="button" class="modal-back-button" data-action="close-modal" aria-label="Back" title="Back"><span aria-hidden="true">←</span></button><h2 id="edit-form-title">${title}</h2></div><form id="edit-form">${body}<div class="modal-actions"><button class="btn primary modal-save-button" type="submit">${saveLabel}</button></div></form></section></div>`}
function field(label,name,value='',type='text',opts={}){let val=esc(value??'');if(type==='textarea')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><textarea name="${name}" ${opts.required?'required':''} placeholder="${esc(opts.placeholder||'')}">${val}</textarea></div>`;if(type==='select')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><select name="${name}">${opts.options.map(o=>{const parts=String(o).split('|'),v=parts.length>1?parts.shift():String(o),text=parts.length?parts.join('|'):String(o);return `<option value="${esc(v)}" ${v===String(value??'')?'selected':''}>${esc(text)}</option>`}).join('')}</select></div>`;return `<div class="field ${opts.full?'full':''}"><label>${label}</label><input name="${name}" type="${type}" value="${val}" ${opts.required?'required':''} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.accept?`accept="${esc(opts.accept)}"`:''} placeholder="${esc(opts.placeholder||'')}"></div>`}
function choiceField(label,name,value,options,segmented=false,optional=false){const choices=optional?['',...options]:options;return `<div class="field full choice-field ${segmented?'choice-segmented':''}"><label>${label}</label><input type="hidden" name="${name}" value="${esc(value??'')}"><div class="choice-options" role="group" aria-label="${label}">${choices.map(option=>{const v=String(option),caption=optional&&v===''?'None':v;return `<button type="button" class="choice-option ${String(value??'')===v?'is-selected':''}" data-choice-name="${name}" data-choice-value="${esc(v)}" aria-pressed="${String(value??'')===v?'true':'false'}">${esc(caption)}</button>`}).join('')}</div></div>`}
let editing=null,formType='';
function openKnowledgeEntry(){openForm('note');}
function openUploadForm(){editing=null;formType='quickUpload';const body='<div class="field full upload-create-field"><label>Choose PDF or images</label><input type="file" name="uploads" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,application/pdf,image/*" multiple><p class="upload-create-hint">Select one or more files · Up to 12 MB per file</p></div>';modal('Upload to My Knowledge',body,'Upload files');}
function openMemoryForm(id){const item=id?(data.memories||[]).find(x=>x.id===id)||{}:{};editing=id||null;formType='memory';const body=field('Memory title','title',item.title,'text',{required:true,full:true,placeholder:'e.g. Preferred answer language'})+field('Type','category',item.category||'Preference','select',{options:['Preference','Personal context','Learning goal','Communication style','Other']})+field('Memory','content',item.content,'textarea',{required:true,full:true,placeholder:'e.g. Explain technical concepts in simple Hinglish with examples.'});modal(id?'Edit memory':'Add personal memory',body,id?'Save changes':'Save memory');}
function openForm(type,id){editing=id||null;formType=type;let obj=id?data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'].find(x=>x.id===id)||{}:{};let body='';
if(type==='note')body=field('Title (optional)','title',obj.title||'','text',{full:true,placeholder:'Give your note a title (optional)'})+field('Content','content',obj.content||'','textarea',{full:true,required:true,placeholder:'Write your note here…'});
if(type==='task')body=field('Task title','title',obj.title,'text',{required:true,full:true,placeholder:'e.g. Computer Networks assignment'})+choiceField('Category (optional)','category',obj.category||'Assignment',['Assignment','Exam','Project','Reading'],false,true)+field('Due date','due',obj.due,'date')+field('Reminder','reminderTime',obj.reminderTime||'09:00','time')+choiceField('Priority','priority',obj.priority||'Medium',['Low','Medium','High'],true,false)+field('Related project (optional)','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)].map(x=>x.includes('|')?x:x),full:true})+field('Notes (optional)','notes',obj.notes,'textarea',{full:true});
if(type==='study')body=field('Subject','subject','','text',{required:true,full:true})+field('Topic / chapter','topic','','text',{full:true})+field('Date','date',today(),'date',{required:true})+field('Duration (minutes)','duration','45','number',{required:true,min:1});
if(type==='project')body=field('Project name','name',obj.name,'text',{required:true,full:true})+field('Description','description',obj.description,'textarea',{full:true})+field('Status','status',obj.status||'In progress','select',{options:['In progress','On hold','Completed']})+field('Target date','targetDate',obj.targetDate,'date');
if(type==='expense')body=field('Transaction type','kind',obj.kind||'expense','select',{options:['expense|Expense / spending','income|Income received','lent|I lent money','borrowed|I borrowed money','lent_repayment|Money returned to me','borrowed_repayment|I repaid money']})+field('Description','description',obj.description,'text',{required:true,full:true,placeholder:'e.g. Lunch / Loan to Rahul'})+field('Person','person',obj.person||'','text',{full:true,placeholder:'Name of person (required for udhaar)'})+field('Amount (₹)','amount',obj.amount,'number',{required:true,min:0})+field('Category','category',obj.category||'Food','select',{options:['Food','Travel','Books & supplies','College fees','Entertainment','Shopping','Other','Udhaar','Repayment']})+field('Date','date',obj.date||today(),'date',{required:true})+field('Due date (udhaar)','dueDate',obj.dueDate||'','date')+field('Related project (optional)','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)] .map(x=>x.includes('|')?x:x),full:true});
const arr=data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'];const old=obj.projectId||'';body=body.replaceAll('value="'+esc(old)+'"','value="'+esc(old)+'"');
modal((id?'Edit ':'')+({note:'Note',task:'task',study:'study session',project:'project',expense:'expense'}[type]),body,id?'Save changes':'Create');const firstField=document.querySelector('#edit-form input:not([type=file]),#edit-form textarea,#edit-form select');if(firstField){firstField.removeAttribute('readonly');firstField.removeAttribute('disabled');firstField.focus();}}
async function saveForm(e){e.preventDefault();if(formType==='quickUpload'){const files=Array.from(e.target.querySelector('[name=uploads]')?.files||[]);if(!files.length){toast('Choose at least one PDF or image');return}const invalid=files.find(f=>f.size>12*1024*1024||!(f.type==='application/pdf'||f.type.startsWith('image/')));if(invalid){toast(invalid.size>12*1024*1024?'Each file must be 12 MB or smaller':'Choose only PDF or image files');return}document.querySelector('#modal-root').innerHTML='';processUploadedDocuments(files);return}const fd=new FormData(e.target),v=Object.fromEntries(fd.entries()),key=(formType==='note'||formType==='quickKnowledge')?'notes':formType==='task'?'tasks':formType==='project'?'projects':'expenses';if(formType==='memory'){data.memories=data.memories||[];const record=editing?data.memories.find(x=>x.id===editing):null;if(record)Object.assign(record,v,{date:today(),updated:Date.now()});else data.memories.push({id:uid(),...v,date:today(),created:Date.now()});persist();if(window.OneAnalytics&&!editing)window.OneAnalytics.trackEvent('memory_created');document.querySelector('#modal-root').innerHTML='';page='memory';render();toast(editing?'Memory updated':'Memory saved');return}if(formType==='quickKnowledge'){v.subject='Knowledge';v.tags='knowledge';if(!String(v.content||'').trim()){toast('Enter content');return}if(!String(v.title||'').trim())v.title='Knowledge Entry';}if(formType==='note'){v.title=String(v.title||'').trim();v.content=String(v.content||'').trim();if(!v.content){toast('Enter note content');return}delete v.subject;delete v.tags;delete v.attachment;delete v.attachmentName;delete v.attachmentType;delete v.attachmentData;}if(['task','expense'].includes(formType)&&v.projectId?.includes('|'))v.projectId=v.projectId.split('|')[0];if(!v.projectId)delete v.projectId;if(formType==='study'){data.studySessions=data.studySessions||[];data.studySessions.push({id:uid(),...v,created:Date.now()});persist();document.querySelector('#modal-root').innerHTML='';render();toast('Study session planned');return}if(formType==='expense'&&(!Number.isFinite(Number(v.amount))||Number(v.amount)<=0)){toast('Enter a valid amount');return}if(formType==='expense'){v.kind=v.kind||'expense';if(v.kind!=='expense'&&!String(v.person||'').trim()){toast('Enter the person name for lending or repayment');return}if(['lent','borrowed','lent_repayment','borrowed_repayment'].includes(v.kind)){v.person=String(v.person).trim();v.description=String(v.description||'').trim()||(({lent:'Lent to ',borrowed:'Borrowed from ',lent_repayment:'Received from ',borrowed_repayment:'Repaid to '}[v.kind]||'Udhaar with ')+v.person);v.category=v.kind.includes('repayment')?'Repayment':'Udhaar'}else delete v.dueDate}let obj=editing?data[key].find(x=>x.id===editing):null;if(obj)Object.assign(obj,v,{updated:Date.now()});else data[key].push({id:uid(),...v,done:false,updated:Date.now(),created:Date.now()});persist();if(formType==='task'){try{const shown=JSON.parse(localStorage.getItem(taskReminderStorageKey())||'{}');const savedTask=editing?data.tasks.find(t=>t.id===editing):data.tasks[data.tasks.length-1];if(savedTask)delete shown[savedTask.id];localStorage.setItem(taskReminderStorageKey(),JSON.stringify(shown));}catch{}setTimeout(checkTaskReminders,0)}if(window.OneAnalytics&&!editing){const eventName={note:'note_created',task:'task_created',project:'project_created',expense:'expense_created'}[formType];if(eventName)window.OneAnalytics.trackEvent(eventName)}document.querySelector('#modal-root').innerHTML='';render();toast(editing?'Changes saved':'Created successfully');if(formType==='note'&&e.target._quickUploadFile){const savedNote=data.notes.find(n=>n.id===editing)||data.notes[data.notes.length-1];await processUploadedDocuments([e.target._quickUploadFile],savedNote?.id||null);e.target._quickUploadFile=null}}
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
      }catch(ocrError){console.warn('Scanned PDF OCR failed',p,ocrError)}
     }
     extracted+='\n[Page '+p+']\n'+(pageText.trim()||'[No readable text found.]')+'\n';
     pg.cleanup?.();
    }
   }else{
    if(window.Tesseract){try{extracted=await runImageOCR(file)}catch(ocrError){console.warn('OCR could not read image; preserving it for Gemini vision.',ocrError)}}
   }
   await saveOriginalDocument(id,file);
   doc.extractedText=extracted.trim()||'[No readable text detected. Original file is available for AI analysis.]';
   doc.chunks=splitDocumentIntoChunks(doc.extractedText);doc.name=file.name;doc.mimeType=file.type||'';doc.size=file.size;doc.fileStored=true;doc.created=Date.now();
   persist();render();toast('Original file and extracted text refreshed');
  }catch(err){console.error(err);toast(err.message||'OCR retry failed')}
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
    if(!window.pdfjsLib){console.warn('PDF.js unavailable; preserving the original PDF for AI analysis.');}else{
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
      }catch(ocrError){console.warn('Scanned PDF OCR failed',p,ocrError)}
     }
     extracted+='\n[Page '+p+']\n'+(pageText.trim()||'[No selectable text detected on this page.]')+'\n';pdfPage.cleanup?.();
    }
    }
   }else{
    setProgress(15,window.Tesseract?'Reading image text · '+file.name:'Saving original image for AI analysis · '+file.name);
    if(window.Tesseract){try{extracted=await runImageOCR(file)}catch(ocrError){console.warn('Image OCR failed. The original image will still be saved for AI visual analysis.',ocrError)}}
   }
   setProgress(88,'Saving '+file.name);const id=uid();let fileStored=false;
   try{await saveOriginalDocument(id,file);fileStored=true}catch(storageError){console.warn('Original file could not be saved; keeping extracted text only.',storageError)}
   const extractedText=extracted.trim()||'[No readable text extracted. '+(fileStored?'Original file is available for AI analysis.':'Try another browser or a clearer file.')+']';
   data.documents=data.documents||[];
   const extractedJson=documentTextToJSON(file.name,extractedText);
   data.documents.push({id,name:file.name,type:isPdf?'pdf':'image',mimeType:file.type||'',size:file.size,extractedText,extractedJson,chunks:splitDocumentIntoChunks(extractedText),created:Date.now(),sourceNoteId:sourceNoteId||null,sourceKind:sourceNoteId?'note-attachment':'uploaded-file',fileStored,jsonStatus:'text_extracted'});
   persist();if(window.OneAnalytics)window.OneAnalytics.trackEvent('document_uploaded');render();setProgress(92,'Extracting structured JSON for '+file.name);toast('File uploaded. Structuring and saving to Knowledge…');await convertDocumentToJSON(id);
  }catch(err){console.error('Document extraction failed',err);setStatus('Could not read '+file.name+': '+(err.message||'unknown error'));toast('Extraction failed. See upload status.')}
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
 }catch(error){doc.jsonStatus='error';doc.jsonError=String(error.message||'Conversion failed');persist();render();console.error('Convert to JSON failed',error);toast(error.message||'Could not convert document');}
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
  console.error('Document JSON extractor module is unavailable.');
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

 const retrieval=aiBuildDocumentEvidence(allDocs,question,targetDocId,{maxDocs:targetDocId?1:6,maxChunks:targetDocId?24:24,maxChars:39000});
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
   }catch(fileError){console.warn('Could not attach matched original image; using extracted text instead.',fileError)}
  }
 }
 const rankedNotes=(data.notes||[]).map(note=>({note,score:aiTextScore([note.title,note.subject,note.tags,note.content].join(' '),terms)})).sort((a,b)=>b.score-a.score||Number(b.note.updated||0)-Number(a.note.updated||0));
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
 const asksTasks=overviewIntent||/\b(?:task|tasks|todo|to-do|deadline|due|planner|today|tomorrow|kal|aaj|priority|pending|overdue|schedule|assignment|homework)\b/i.test(question);
 const asksProjects=overviewIntent||/\b(?:project|projects|milestone|progress)\b/i.test(question);
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
 const body={message:question,workspace:context.workspace,allowedSources:context.sources,inlineFile:context.inlineFile};
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
 (data.documents||[]).forEach(item=>add(item.name||'Uploaded item','File · Uploaded Items',aiTextScore([item.name,item.extractedText].join(' '),queryTerms),String(item.extractedText||'').slice(0,220)));
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
 if(pendingChatAction){
  const pending=pendingChatAction;
  if(/^(?:yes|yes confirm|confirm|confirm delete|haan|ha|kar do|delete it|proceed)$/i.test(lower)){
   pendingChatAction=null;
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
 const verify=(key,record)=>{try{const disk=JSON.parse(localStorage.getItem(workspaceStorageKey())||'{}');return Array.isArray(disk[key])&&disk[key].some(x=>x.id===record.id)}catch{return false}};
 const parseDate=()=>{
  const addDays=n=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
  if(/\b(?:tomorrow|kal|next day)\b/i.test(lower))return addDays(1);
  if(/\b(?:today|aaj|abhi)\b/i.test(lower))return today();
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
  data.expenses.push(record);persist();
  if(!verify('expenses',record))return {answer:'Money record save hone ki verification fail hui. Main ise added nahi bolunga; Money & Udhaar check karo.',sources:[]};
  const sync=await syncResult();page='expenses';window.moneyTab='udhaar';window.expenseMonth=transactionDate.slice(0,7);render();
  return {answer:'Money & Udhaar mein saved: '+fmtMoney(amount)+' Arbaj ko diye'+(dueDate?' · wapas lene ki date '+dateFmt(dueDate):'')+'. Saved record verify kar liya hai.'+sync,sources:['Money & Udhaar']};
 }
 const reminderIntent=/\b(?:remind me to|remind me about|set a reminder|reminder for|yaad dilana|yaad dila dena|mujhe yaad dilana)\b/i.test(lower);
 if(reminderIntent&&!/\b(?:task|todo|assignment|deadline|homework|exam|submit|kaam)\b/i.test(lower)){
  const due=parseDate();
  if(!due)return {answer:'Reminder ki date batao. Example: Remind me to pay electricity bill tomorrow at 7 pm.',sources:['Planner']};
  const timeMatch=raw.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)\b/i);
  let reminderTime='09:00';
  if(timeMatch){let hour=Number(timeMatch[1]),minute=Number(timeMatch[2]||0),meridiem=(timeMatch[3]||'').toLowerCase();if(hour>12||hour<1||minute>59)return {answer:'Reminder time valid nahi hai. Example: 7:30 pm.',sources:['Planner']};if(meridiem==='pm'&&hour<12)hour+=12;if(meridiem==='am'&&hour===12)hour=0;reminderTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')}
  const title=raw.replace(/^\s*(?:please\s+)?(?:remind me to|remind me about|set a reminder(?: for)?|reminder for|yaad dilana|yaad dila dena|mujhe yaad dilana)\s*/i,'').replace(/\b(?:today|tomorrow|kal|aaj|next day|next week|agle hafte|in\s+\d+\s+days?|after\s+\d+\s+days?|\d+\s+din\s+(?:baad|mein))\b/ig,'').replace(/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/g,'').replace(/\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/ig,'').replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b/ig,'').replace(/\b(?:on|at|by|please)\b/ig,'').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title)return {answer:'Kis cheez ka reminder chahiye? Example: Remind me to call home tomorrow at 7 pm.',sources:['Planner']};
  const duplicate=(data.tasks||[]).find(t=>!t.done&&String(t.title||'').toLowerCase()===title.toLowerCase()&&t.due===due);
  if(duplicate)return {answer:'Reminder already exists for '+title+' on '+dateFmt(due)+'. Duplicate nahi banaya.',sources:['Planner']};
  const task={id:uid(),title,category:'Reminder',due,reminderTime,priority:'Medium',done:false,created:Date.now(),updated:Date.now()};
  data.tasks.push(task);persist();
  if(!verify('tasks',task))return {answer:'Reminder save verify nahi hua. Planner check karo.',sources:[]};
  const sync=await syncResult();page='planner';render();setTimeout(checkTaskReminders,0);
  return {answer:'Reminder saved: '+title+' · '+dateFmt(due)+' at '+reminderTime+'. Enable notifications in One to receive a browser alert when One is open or reopened.'+sync,sources:['Planner']};
 }
 const addTask=/\b(?:add|create|make|remind me|schedule|bana do|banao|add kar|jod do|likh lo|yaad dilana)\b/i.test(lower)&&/\b(?:task|todo|assignment|deadline|homework|exam|submit|kaam)\b/i.test(lower);
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
  data.tasks.push(task);persist();
  if(!verify('tasks',task))return {answer:'Task save verify nahi hua, isliye confirm nahi kar raha. Planner check karo.',sources:[]};
  const sync=await syncResult();page='planner';render();return {answer:'Task saved in Planner: '+title+(due?' · Due '+dateFmt(due):' · No due date')+(notes?' · Notes: '+notes:'')+'. Saved task verify kar liya.'+sync,sources:['Planner']};
 }
 const addNote=/\b(?:add|save|create|write|likh|save kar)\b/i.test(lower)&&/\b(?:note|notes|notepad)\b/i.test(lower);
 if(addNote){
  const content=raw.replace(/^\s*(?:please\s+)?(?:add|save|create|write|likh(?:\s+do)?|save kar(?:\s+do)?)\s+(?:a\s+)?note\s*[:\-]?\s*/i,'').trim();
  if(!content)return {answer:'Note ka content bhi likho. Example: Save note: Kal project meeting hai.',sources:['Notes & Memory']};
  const duplicate=(data.notes||[]).find(item=>String(item.content||'').trim().toLowerCase()===content.toLowerCase()&&Date.now()-Number(item.created||0)<24*60*60*1000);
  if(duplicate)return {answer:'This exact note was already saved recently. I did not create a duplicate.',sources:['Notes & Memory']};
  const note={id:uid(),title:'Quick note',content,subject:'Quick note',tags:'chat capture',created:Date.now(),updated:Date.now()};
  data.notes.push(note);persist();
  if(!verify('notes',note))return {answer:'Note save verify nahi hua; main saved nahi bolunga.',sources:[]};
  const sync=await syncResult();page='notes';render();return {answer:'Note Notes & Memory mein save ho gaya: '+content+'.'+sync,sources:['Notes & Memory']};
 }
 const addProject=/\b(?:add|create|start|banao|bana do)\b/i.test(lower)&&/\bproject\b/i.test(lower);
 if(addProject){
  const name=raw.replace(/^\s*(?:please\s+)?(?:add|create|start|banao|bana do)\s+(?:a\s+)?project\s*/i,'').replace(/\s+/g,' ').trim();
  if(!name)return {answer:'Project ka naam batao. Example: Create project Hapn redesign.',sources:['Projects']};
  const duplicate=(data.projects||[]).find(item=>String(item.name||item.title||'').trim().toLowerCase()===name.toLowerCase());
  if(duplicate)return {answer:'A project with this name already exists: "'+(duplicate.name||duplicate.title)+'". I did not create a duplicate.',sources:['Projects']};
  const project={id:uid(),name,description:'',status:'In progress',targetDate:'',created:Date.now(),updated:Date.now()};
  data.projects.push(project);persist();
  if(!verify('projects',project))return {answer:'Project save verify nahi hua; main saved nahi bolunga.',sources:[]};
  const sync=await syncResult();page='projects';render();return {answer:'Project created: '+name+'. Projects mein saved aur verified hai.'+sync,sources:['Projects']};
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
  data.expenses.push(record);persist();
  if(!verify('expenses',record))return {answer:'Money record save verify nahi hua. Money section check karo.',sources:[]};
  const sync=await syncResult();page='expenses';window.expenseMonth=date.slice(0,7);render();
  return {answer:(kind==='income'?'Income received: ':'Expense saved: ')+fmtMoney(amount)+' for '+description+' on '+dateFmt(date)+'.'+sync,sources:['Money & Udhaar']};
 }

 const complete=/\b(?:complete|finish|mark|done|ho gaya|kar diya)\b/i.test(lower)&&/\b(?:task|assignment|todo|kaam|done)\b/i.test(lower);
 if(complete){
  const needle=raw.replace(/\b(?:please|complete|finish|mark|as|done|task|the|my|todo|assignment|kaam|ho gaya|kar diya)\b/ig,' ').trim().toLowerCase();
  const found=(data.tasks||[]).filter(t=>!t.done&&needle&&String(t.title||'').toLowerCase().includes(needle));
  if(found.length===1){found[0].done=true;found[0].completedAt=Date.now();found[0].updated=Date.now();persist();if(!verify('tasks',found[0]))return {answer:'Task completion save verify nahi hua.',sources:[]};page='planner';render();return {answer:'Task "'+found[0].title+'" completed and saved.',sources:['Planner']}}
  return {answer:found.length?'Multiple tasks mile. Exact task name batao.':'Woh open task nahi mila. Saved task ka exact naam batao.',sources:['Planner']};
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
 if(isStructuredWorkspaceQuestion(query)&&!targetDocId){
  const local=aiAnswer(query);data.messages.push({role:'assistant',content:local.answer,sources:local.sources});persist();render();scrollChatToBottom();return
 }
 chatBusy=true;render();scrollChatToBottom();
 try{const result=await requestStudentBrainAI(query,targetDocId);data.messages.push({role:'assistant',content:result.answer,sources:result.sources})}
 catch(error){
  console.error('Ask My Brain AI request failed',error);
  const fallback=aiAnswer(query),hasFallback=Array.isArray(fallback.sources)&&fallback.sources.length>0;
  data.messages.push({role:'assistant',content:(hasFallback?fallback.answer+'\n\n':'')+'AI connection: '+(error.message||'Unable to reach the AI service.')+(hasFallback?'\nShowing the local search fallback above.':'\nYour saved data is still stored locally. Retry after the AI setup issue is fixed.'),sources:hasFallback?fallback.sources:[]});
 }finally{chatBusy=false;persist();render();scrollChatToBottom()}
}

function action(name,id){if(name!=='open-quick-add'&&name!=='quick-add-upload'&&name!=='close-quick-add')closeQuickAddMenu();const modalRoot=document.querySelector('#modal-root');if(name!=='open-quick-add'&&name!=='quick-add-upload'&&modalRoot?.querySelector('.quick-add-modal'))modalRoot.innerHTML='';const map={ 'open-quick-add':()=>openQuickAdd(),'new-knowledge-entry':()=>openForm('note'),'quick-add-upload':()=>openUploadForm(),'close-quick-add':()=>closeQuickAddMenu(),'new-note':()=>openForm('note'),'new-memory':()=>openMemoryForm(),'edit-memory':()=>openMemoryForm(id),'delete-memory':()=>{if(confirm('Delete this saved memory?')){data.memories=(data.memories||[]).filter(m=>m.id!==id);persist();render();toast('Memory deleted')}},'go-memory':()=>{page='memory';render()},'voice-quick-command':()=>{if(window.startStudentBrainListening)window.startStudentBrainListening();else toast('Voice assistant is loading. Try again.');},'edit-note':()=>openForm('note',id),'delete-note':()=>confirmDelete('notes',id),'delete-document':()=>{removeOriginalDocument(id);data.documents=(data.documents||[]).filter(d=>d.id!==id);persist();render();toast('Document deleted')},'retry-document-ocr':()=>retryDocumentOCR(id),'convert-document-json':()=>convertDocumentToJSON(id),'copy-document-json':()=>copyDocumentJSON(id),'download-document-json':()=>downloadDocumentJSON(id),'save-document-json':()=>{const doc=(data.documents||[]).find(d=>d.id===id);if(doc?.extractedJson){doc.jsonSavedToKnowledge=true;doc.jsonSavedAt=Date.now();doc.jsonStatus='saved_to_knowledge';persist();render();toast('JSON saved to My Knowledge')}else toast('Convert to JSON first')},'ask-document':()=>askDocument(id),'new-task':()=>{openForm('task');if(window.plannerSelectedDate){const dueField=document.querySelector('#edit-form [name=due]');if(dueField)dueField.value=window.plannerSelectedDate}},'enable-reminders':()=>enableTaskReminders(),'share-task-whatsapp':()=>shareTaskReminder(id,'whatsapp'),'share-task-telegram':()=>shareTaskReminder(id,'telegram'),'save-money-budget':()=>{const amount=Number(document.querySelector('#money-budget-amount')?.value||0),month=window.expenseMonth||today().slice(0,7);if(!Number.isFinite(amount)||amount<=0){toast('Enter a valid monthly budget');return}data.moneyBudgets=Array.isArray(data.moneyBudgets)?data.moneyBudgets:[];const existing=data.moneyBudgets.find(x=>x.month===month);if(existing)existing.amount=amount;else data.moneyBudgets.push({month,amount,updated:Date.now()});persist();render();toast('Monthly budget saved')},'new-study':()=>openForm('study'),'edit-task':()=>openForm('task',id),'delete-task':()=>confirmDelete('tasks',id),'new-project':()=>openForm('project'),'edit-project':()=>openForm('project',id),'new-expense':()=>{openForm('expense');if(id&&['lent','borrowed'].includes(id)){const kindField=document.querySelector('#edit-form [name=kind]');if(kindField)kindField.value=id;const categoryField=document.querySelector('#edit-form [name=category]');if(categoryField)categoryField.value='Udhaar'}},'loan-repayment':()=>{const person=id,hasLent=data.expenses.some(e=>e.person===person&&e.kind==='lent');openForm('expense');const kindField=document.querySelector('#edit-form [name=kind]');if(kindField)kindField.value=hasLent?'lent_repayment':'borrowed_repayment';const personField=document.querySelector('#edit-form [name=person]');if(personField)personField.value=person;const categoryField=document.querySelector('#edit-form [name=category]');if(categoryField)categoryField.value='Repayment';const descriptionField=document.querySelector('#edit-form [name=description]');if(descriptionField)descriptionField.value=(hasLent?'Received from ':'Repaid to ')+person},'loan-person-history':()=>{window.loanPersonFilter=id;page='loans';render();document.querySelector('.loan-history-title')?.scrollIntoView({behavior:'smooth'})},'loan-clear-filter':()=>{window.loanPersonFilter='';render()},'expense-quick-action':()=>{if(id==='all'){window.expenseMonth='';render();return}openForm('expense');const typeField=document.querySelector('#edit-form [name=kind]');if(typeField){typeField.value=id;typeField.dispatchEvent(new Event('change',{bubbles:true}))}const descriptionField=document.querySelector('#edit-form [name=description]');if(descriptionField){descriptionField.focus();descriptionField.setSelectionRange?.(0,descriptionField.value.length)}const categoryField=document.querySelector('#edit-form [name=category]');if(categoryField&&id.includes('repayment'))categoryField.value='Repayment';const personField=document.querySelector('#edit-form [name=person]');if(personField&&id!=='expense')personField.placeholder='Who was the money for/from?'},'edit-expense':()=>openForm('expense',id),'delete-expense':()=>confirmDelete('expenses',id),'delete-study':()=>{data.studySessions=(data.studySessions||[]).filter(x=>x.id!==id);persist();render();toast('Study session removed')},'planner-view':()=>{window.plannerView=id;render();requestAnimationFrame(()=>document.querySelector('.planner-view-heading')?.scrollIntoView({behavior:'smooth',block:'start'}))},'planner-date':()=>{window.plannerSelectedDate=id;render();document.querySelector('.planner-selected-date')?.scrollIntoView({behavior:'smooth',block:'nearest'})},'planner-month':()=>{const base=window.plannerMonth||today().slice(0,7);if(id==='today')window.plannerMonth=today().slice(0,7);else{const [year,month]=base.split('-').map(Number),next=new Date(year,month-1+(id==='next'?1:-1),1);window.plannerMonth=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')}window.plannerSelectedDate=null;render()},'go-ask':()=>{page='ask';render()},'toggle-task-section':()=>{window.taskSectionExpanded=(window.taskSectionExpanded||'open')===id?'':id;render();},'go-planner':()=>{page='planner';window.plannerView='All';render()},'go-udhaar':()=>{page='expenses';window.moneyTab='udhaar';render()},'go-money-reports':()=>{page='expenses';window.moneyTab='reports';window.expenseMonth=today().slice(0,7);render()},'go-knowledge':()=>{page='knowledge';render()},'toggle-task':()=>{let t=data.tasks.find(x=>x.id===id);if(!t)return;t.done=!t.done;if(t.done)t.completedAt=Date.now();else delete t.completedAt;persist();render();toast(t.done?'Task marked complete':'Task moved back to open tasks')},'all-expenses':()=>{window.expenseMonth='';render()},'export-data':()=>exportData(),'restore-data':()=>restoreData(),'clear-data':()=>clearData(),'close-modal':()=>{document.querySelector('#modal-root').innerHTML='';closeQuickAddMenu();document.querySelector('.floating-create-button')?.classList.remove('is-hidden')}};map[name]?.()}
function confirmDelete(key,id){const item=data[key].find(x=>x.id===id);if(!item)return;if(confirm(`Delete "${item.title||item.name||item.description}"? This cannot be undone.`)){data[key]=data[key].filter(x=>x.id!==id);persist();render();toast('Deleted')}}
function restoreData(){const f=document.querySelector('#restore-file')?.files?.[0];if(!f){toast('Choose a JSON backup first');return}const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed||!Array.isArray(parsed.notes)||!Array.isArray(parsed.tasks))throw Error('Invalid backup');if(!confirm('Restore this backup and replace current workspace data?'))return;data={...starter(),...parsed};persist();page='overview';render();toast('Backup restored')}catch(e){toast('Invalid Student Brain backup file')}};reader.readAsText(f)}
function exportData(){try{const payload={app:'Student Brain',backupVersion:1,exportedAt:new Date().toISOString(),data:migrateData(data)},blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='student-brain-backup-'+today()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup downloaded')}catch(err){console.error('Backup export failed',err);toast('Could not create backup. Check browser storage and try again.')}}
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
 }catch(err){console.error('Restore failed',err);toast(err.message||'Invalid backup file')}};
 reader.onerror=()=>toast('Could not read backup file. Try selecting it again.');reader.readAsText(f);
}
function clearData(){if(confirm('Delete all Student Brain data saved in this browser? Export first if you need a backup.')){data=starter();persist();render();toast('Local data cleared')}}
document.addEventListener('click',e=>{const moneyTab=e.target.closest('[data-money-tab]');if(moneyTab){window.moneyTab=moneyTab.dataset.moneyTab;page='expenses';render();return}const copyButton=e.target.closest('[data-copy-message]');if(copyButton){const index=Number(copyButton.dataset.copyMessage);const message=data.messages[index];if(message){const value=String(message.content||'');if(navigator.clipboard?.writeText){navigator.clipboard.writeText(value).then(()=>toast('Message copied')).catch(()=>toast('Could not copy message'));}else{const temp=document.createElement('textarea');temp.value=value;temp.style.position='fixed';temp.style.opacity='0';document.body.appendChild(temp);temp.select();try{document.execCommand('copy');toast('Message copied')}catch(_){toast('Could not copy message')}temp.remove();}}return}const choice=e.target.closest('[data-choice-name]');if(choice){const form=choice.closest('form');const input=form?.querySelector('[name="'+choice.dataset.choiceName+'"]');if(input){input.value=choice.dataset.choiceValue;choice.parentElement.querySelectorAll('[data-choice-name="'+choice.dataset.choiceName+'"]').forEach(option=>{const selected=option===choice;option.classList.toggle('is-selected',selected);option.setAttribute('aria-pressed',selected?'true':'false')})}return}if(e.target.closest('.create-radial-backdrop')){e.preventDefault();closeQuickAddMenu();return}const backdrop=e.target.closest('.modal-backdrop');if(backdrop&&e.target===backdrop){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal')){const modalAction=e.target.closest('[data-action]');if(modalAction){e.preventDefault();e.stopPropagation();action(modalAction.dataset.action,modalAction.dataset.id);return}return}const close=e.target.closest('[data-action="close-modal"]');if(close){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal'))return;const pg=e.target.closest('[data-page]');if(pg){document.querySelector('#modal-root').innerHTML='';page=pg.dataset.page;history.pushState({sbPage:page},'',location.href);render();return}const a=e.target.closest('[data-action]');if(a){action(a.dataset.action,a.dataset.id);return}const q=e.target.closest('[data-question]');if(q){sendChat(q.dataset.question);return}});
document.addEventListener('submit',e=>{if(e.target.id==='home-quick-note-form'){e.preventDefault();const fd=new FormData(e.target),content=String(fd.get('content')||'').trim(),title=String(fd.get('title')||'').trim();if(!content){toast('Write something first');return}data.notes.push({id:uid(),title:title||'Quick note',content,subject:'Quick note',tags:'quick capture',created:Date.now(),updated:Date.now()});persist();e.target.reset();toast('Note saved to One');return}if(e.target.id==='edit-form')saveForm(e);if(e.target.id==='chat-form'){e.preventDefault();const i=document.querySelector('#chat-input');sendChat(i.value);}if(e.target.id==='home-brain-search'){e.preventDefault();const q=document.querySelector('#home-brain-query')?.value.trim();page='ask';render();if(q)sendChat(q);else document.querySelector('#chat-input')?.focus()}});
document.addEventListener('input',e=>{if(e.target.id==='note-search'){window.noteQuery=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}});
document.addEventListener('change',e=>{if(e.target.id==='restore-file')updateRestorePreview();if(e.target.id==='document-upload')processUploadedDocuments(e.target.files);if(e.target.id==='quick-add-file-upload'){const selected=Array.from(e.target.files||[]);e.target.value='';processUploadedDocuments(selected)}if(e.target.id==='subject-filter'){window.subjectFilter=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}if(e.target.id==='task-filter'){window.taskFilter=e.target.value;render()}if(e.target.id==='expense-month'){window.expenseMonth=e.target.value;render()}});

window.handleStudentBrainVoiceCommand = function(raw) {
 const text=String(raw||'').trim(), lower=text.toLowerCase();
 if(!text)return false;
 const m=text.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?:\s*(?:rupees?|rs\.?|रुपये|रुपए))?/i);
 const amount=m?Number(m[1].replace(/,/g,'')):null;
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
  console.error('Voice command failed',err);
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
 try{const permission=await Notification.requestPermission();if(permission==='granted'){toast('Task reminders enabled');checkTaskReminders()}else toast('Notifications blocked. Allow them in browser site settings.')}
 catch(err){toast('Could not enable notifications')}
}
async function checkTaskReminders(){
 if(!('Notification' in window)||Notification.permission!=='granted')return;
 let shown={};try{shown=JSON.parse(localStorage.getItem(taskReminderStorageKey())||'{}')}catch{}
 const now=Date.now(),notify=async(title,body,tag)=>{
  const reg=await navigator.serviceWorker?.ready;
  if(reg?.showNotification)await reg.showNotification(title,{body,icon:'./icons/student-brain.svg',tag,data:{url:'./'}});
  else new Notification(title,{body,tag});
 };
 for(const task of (data.tasks||[])){
  if(task.done||!task.due||shown[task.id])continue;
  const when=taskReminderDayTime(task);
  if(when!==null&&now>=when&&now<when+24*60*60*1000){
   try{await notify('One · Task reminder',task.title+' is due today at '+(task.reminderTime||'09:00')+'.','task-'+task.id);shown[task.id]=true}
   catch(err){console.warn('Task notification failed',err)}
  }
 }
 const loanRows=(data.expenses||[]).filter(e=>['lent','borrowed'].includes(e.kind)&&e.dueDate&&e.dueDate<=today());
 for(const entry of loanRows){
  const group=(data.expenses||[]).filter(e=>e.person===entry.person&&((entry.kind==='lent'&&['lent','lent_repayment'].includes(e.kind))||(entry.kind==='borrowed'&&['borrowed','borrowed_repayment'].includes(e.kind))));
  const original=group.filter(e=>e.kind===entry.kind).reduce((n,e)=>n+Number(e.amount||0),0);
  const repaid=group.filter(e=>e.kind===(entry.kind==='lent'?'lent_repayment':'borrowed_repayment')).reduce((n,e)=>n+Number(e.amount||0),0);
  if(original-repaid<=0)continue;
  const key='loan-'+entry.id,last=Number(shown[key]||0),when=new Date(entry.dueDate+'T09:00:00').getTime();
  if(now<when||now-last<24*60*60*1000)continue;
  try{await notify('One · Udhaar repayment reminder',(entry.kind==='lent'?'Expected repayment from ':'Repayment due to ')+(entry.person||'Unknown')+' · '+money(entry.amount)+' · '+(entry.dueDate<today()?'Overdue since ':'Due today: ')+dateFmt(entry.dueDate),key);shown[key]=now}
  catch(err){console.warn('Udhaar notification failed',err)}
 }
 try{localStorage.setItem(taskReminderStorageKey(),JSON.stringify(shown))}catch(err){console.warn('Could not save reminder history',err)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>checkTaskReminders());
else checkTaskReminders();
setInterval(checkTaskReminders,60000);window.addEventListener('focus',checkTaskReminders);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkTaskReminders()});

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
   try{data=migrateData(JSON.parse(saved))}catch(error){console.error('Account workspace could not be read; preserving its raw backup.',error);data=starter()}
  }else{data=starter();localStorage.setItem(activeWorkspaceKey,JSON.stringify(data))}
  await migrateWorkspaceToIndexedDB();
  render();
  if(nextUserId){
   try{await activateCloudWorkspace(nextUserId)}
   catch(error){console.error('Cloud workspace activation failed',error);cloudReady=false;cloudUser=null;setCloudMode('error','Saved locally. Cloud sync could not start: '+(error.message||'Unknown error'))}
  }else setCloudMode('offline','Guest data is saved only on this device. Sign in to sync across devices.');
  render();
 });
 return workspaceSwitchQueue;
}
window.addEventListener('one:auth-changed',event=>{switchAccountWorkspace(event.detail?.user||null)});
initCloud();
migrateWorkspaceToIndexedDB();
requestWorkspaceStoragePersistence();

document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.querySelector('.create-radial-menu'))closeQuickAddMenu();else if(document.querySelector('.modal-backdrop'))action('close-modal')}});
