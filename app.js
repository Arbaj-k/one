const KEY='student-brain-data-v1';
const DATA_SCHEMA_VERSION=2;
const starter=()=>({schemaVersion:DATA_SCHEMA_VERSION,notes:[],tasks:[],projects:[],expenses:[],messages:[],studySessions:[],documents:[],memories:[]});
function migrateData(raw){
 const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const next={...starter(),...source};
 for(const key of ['notes','tasks','projects','expenses','messages','studySessions','documents','memories'])if(!Array.isArray(next[key]))next[key]=[];
 next.schemaVersion=DATA_SCHEMA_VERSION;
 return next;
}
let data=loadData(),page='overview',chatBusy=false;
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
  const req=indexedDB.open(AI_FILES_DB,1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'id'})};
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

function loadData(){try{return migrateData(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch{return starter()}}
let syncQueue=Promise.resolve();
let cloudRetryTimer=null,cloudRetryDelay=1500,lastSyncedAt=null,cloudMode='offline',cloudLastError='';
function cloudStatus(message){
 const el=document.querySelector('#cloud-status');
 if(el){
  const label=cloudMode==='synced'?'Synced':cloudMode==='offline'?'Offline':cloudMode==='error'?'Error':cloudMode==='syncing'?'Syncing…':'Connecting…';
  const time=lastSyncedAt?' · Last synced '+new Date(lastSyncedAt).toLocaleString():' · Not synced yet';
  el.textContent=label+time;
  el.title=cloudLastError||message||'';
  el.dataset.state=cloudMode;
 }
}
function setCloudMode(mode,error=''){
 cloudMode=mode;cloudLastError=error;
 cloudStatus();
}
function persist(){
 try{
  localStorage.setItem(KEY,JSON.stringify(data));
  localStorage.setItem(KEY+'-last-good',JSON.stringify(data));
  setCloudMode('offline','Saved locally on this device.');
 }catch(err){
  console.error('Local save failed',err);
  setCloudMode('error',err.message);
  toast('Local save failed. Export a backup and free storage.');
 }
}
function queueCloudSave(){
 const snapshot=JSON.parse(JSON.stringify(data));
 setCloudMode(navigator.onLine?'syncing':'offline');
 syncQueue=syncQueue.catch(()=>{}).then(()=>saveCloudSnapshot(snapshot));
}
async function saveCloudSnapshot(snapshot){
 try{
  if(!navigator.onLine)throw Error('Device is offline');
  const {error}=await cloudClient.from('profiles').upsert({id:cloudUser.id,workspace_data:snapshot,updated_at:new Date().toISOString()},{onConflict:'id'});
  if(error)throw error;
  cloudRetryDelay=1500;lastSyncedAt=new Date().toISOString();
  setCloudMode('synced');
 }catch(err){
  console.error('Cloud sync failed',err);
  setCloudMode(navigator.onLine?'error':'offline',err.message);
  if(cloudRetryTimer)clearTimeout(cloudRetryTimer);
  cloudRetryTimer=setTimeout(()=>{if(cloudReady&&cloudClient&&cloudUser&&navigator.onLine)queueCloudSave()},cloudRetryDelay);
  cloudRetryDelay=Math.min(cloudRetryDelay*2,60000);
 }
}
// Local-first storage: all workspace records stay in this browser/device.
const LOCAL_ONLY=true;
function initCloud(){
 setCloudMode('offline','Local-only mode: data is saved on this device.');
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
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function toast(msg){const t=document.querySelector('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove('show'),2300)}
function empty(msg,icon='✧'){return `<div class="empty"><div class="empty-symbol">${icon}</div>${esc(msg)}</div>`}
function titleBlock(kicker,title,sub,button=''){return `<div class="row" style="align-items:flex-start"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subtitle">${sub}</p></div>${button}</div>`}
function btn(label,action,primary=false,small=false){return `<button class="btn ${primary?'primary':''} ${small?'small':''}" data-action="${action}">${label}</button>`}
function stat(label,num,note,icon,target){return `<div class="card stat-card" ${target?`data-page="${target}" role="button" tabindex="0" title="Open ${esc(label)}"`:''}><div class="row"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-number">${num}</div><div class="stat-note">${note}${target?'<span class="stat-open-hint"> · View details →</span>':''}</div></div>`}
function taskRow(t){const overdue=!t.done&&t.due&&t.due<today(),dueLabel=t.due?(overdue?'Overdue · ': 'Due · ')+dateFmt(t.due):'No due date';return `<div class="list-item planner-task ${overdue?'is-overdue':''} ${t.done?'is-complete':''}"><button class="task-check ${t.done?'checked':''}" type="button" role="checkbox" aria-checked="${!!t.done}" data-action="toggle-task" data-id="${t.id}" title="${t.done?'Mark incomplete':'Mark complete'}">${t.done?'✓':''}</button><div class="list-copy"><b class="${t.done?'task-done':''}">${esc(t.title)}</b><small>${esc(t.category||'General')} · <span class="task-due">${dueLabel}</span></small></div><span class="priority ${esc(t.priority||'Medium')}">${esc(t.priority||'Medium')}</span></div>`}
function noteRow(n){return `<div class="list-item"><div class="list-icon">▤</div><div class="list-copy"><b>${esc(n.title)}</b><small>${esc(n.subject||'General')} · ${new Date(n.updated).toLocaleDateString('en-IN')}</small></div><button class="btn small" data-action="edit-note" data-id="${n.id}">Open</button></div>`}
function projectCard(p){const tasks=data.tasks.filter(t=>t.projectId===p.id),done=tasks.filter(t=>t.done).length;return `<div class="card"><div class="row"><span class="stat-icon">▣</span><span class="tag ${p.status==='Completed'?'green':'blue'}">${esc(p.status||'In progress')}</span></div><h3 style="margin-top:17px">${esc(p.name)}</h3><p class="muted" style="font-size:12px;line-height:1.6;min-height:38px">${esc(p.description||'No description yet.')}</p><div class="row"><small class="muted">${tasks.length} tasks · ${dateFmt(p.targetDate)}</small><button class="btn small" data-action="edit-project" data-id="${p.id}">Edit</button></div>${tasks.length?`<div class="progress"><span style="width:${Math.round(done/tasks.length*100)}%"></span></div>`:''}</div>`}
function scrollChatToBottom(){const chat=document.querySelector('#chat-messages');if(!chat)return;const scroll=()=>{chat.scrollTop=chat.scrollHeight;const last=chat.lastElementChild;if(last)last.scrollIntoView({block:'end',behavior:'auto'});};scroll();requestAnimationFrame(()=>requestAnimationFrame(scroll));}
function render(){try{document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));let c=document.querySelector('#page-content');if(!c)throw Error('Main page container is missing');const pages={overview,ask,knowledge,planner,tasks,study:studyPlanner,backup:backupRestore,projects,expenses,settings,memory:personalMemory};c.innerHTML=(pages[page]||overview)();if(page==='ask')scrollChatToBottom();document.querySelector('.mobile-nav')?.remove();const mob=document.createElement('div');mob.className='mobile-nav';[['overview','▦','Home'],['planner','☑','Tasks'],['study','📚','Study'],['knowledge','▤','Notes'],['voice','🎙','Voice']].forEach(([p,i,l])=>{if(p==='quick-add'){mob.innerHTML+='<button class="mobile-quick-add" data-action="open-quick-add" aria-label="Quick add"><strong>'+i+'</strong><span>Add</span></button>';return}if(p==='voice'){mob.innerHTML+='<button class="mobile-mic" data-action="voice-quick-command" aria-label="Start voice assistant"><strong>'+i+'</strong><span>Speak</span></button>';return}mob.innerHTML+='<button class="'+(page===p?'active':'')+'" data-page="'+p+'"><strong>'+i+'</strong>'+l+'</button>'});document.body.appendChild(mob)}catch(err){console.error('Student Brain render failed',err);const c=document.querySelector('#page-content');if(c)c.innerHTML='<section class="card"><h2>Workspace could not load</h2><p>Refresh the page. If this continues, export your backup before clearing browser data, then share the browser console error.</p><small></small></section>';const msg=document.querySelector('#page-content small');if(msg)msg.textContent=String(err?.message||err)}}
function openQuickAdd(){const root=document.querySelector('#modal-root');if(!root)return;root.innerHTML='<div class="modal-backdrop"><section class="modal quick-add-modal" role="dialog" aria-modal="true" aria-labelledby="quick-add-title"><div class="modal-head"><div><div class="eyebrow">FAST ADD</div><h2 id="quick-add-title">What would you like to add?</h2></div><button class="xbtn" data-action="close-modal" aria-label="Close">×</button></div><div class="quick-add-grid"><button class="quick-add-option" data-action="new-note"><span>▤</span><b>Note</b><small>Save a thought or class note</small></button><button class="quick-add-option" data-action="new-task"><span>☑</span><b>Task</b><small>Add an assignment or deadline</small></button><button class="quick-add-option" data-action="new-study"><span>📚</span><b>Study session</b><small>Log your study time</small></button><button class="quick-add-option" data-action="new-expense"><span>₹</span><b>Money record</b><small>Track spend or udhaar</small></button><button class="quick-add-option" data-action="new-project"><span>▣</span><b>Project</b><small>Start a project workspace</small></button><button type="button" class="quick-add-option" data-action="quick-add-upload"><span>📎</span><b>Upload file</b><small>PDF or image · Save to My Knowledge</small></button></div><input id="quick-add-file-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,application/pdf,image/*" multiple hidden><div id="quick-add-upload-status" class="quick-add-upload-status" role="status" aria-live="polite">Choose a PDF or image to add it to My Knowledge (up to 12 MB each).</div></section></div>';}function overview(){const open=data.tasks.filter(t=>!t.done),due=open.filter(t=>t.due&&t.due>=today()).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,4),recent=[...data.notes].sort((a,b)=>b.updated-a.updated).slice(0,4),month=today().slice(0,7),spend=data.expenses.filter(e=>(e.kind||'expense')==='expense'&&e.date?.startsWith(month)).reduce((s,e)=>s+Number(e.amount||0),0);return `${titleBlock('YOUR PERSONAL WORKSPACE','Good to see you again 👋','Your college life, organized in one place.',`<div class="quick-actions">${btn('+ Add','open-quick-add',true)}</div>`)}<div class="hero-card"><div class="eyebrow" style="color:#c8d5ff">YOUR PERSONAL BRAIN</div><h2>Less searching. More learning.</h2><p>Save what matters, keep track of what’s next, and ask questions about your own notes and projects.</p>${btn('Ask your Brain →','go-ask',true)}</div><div class="grid stats">${stat('Knowledge notes',data.notes.length,'Saved in this browser','▤','knowledge')}${stat('Open tasks',open.length,'Assignments & deadlines','◷','tasks')}${stat('Active projects',data.projects.filter(p=>p.status!=='Completed').length,'Your workspaces','▣','projects')}${stat('Spent this month',money(spend),'Based on your expense records','₹','expenses')}</div><div class="grid two-col"><div class="card"><div class="row"><h2>Coming up</h2>${btn('View planner','go-planner',false,true)}</div><div class="list">${due.length?due.map(taskRow).join(''):empty('No upcoming tasks. Add an assignment or deadline.','◷')}</div><div style="margin-top:13px">${btn('+ Add task','new-task')}</div></div><div class="card"><div class="row"><h2>Recently saved</h2>${btn('All notes','go-knowledge',false,true)}</div><div class="list">${recent.length?recent.map(noteRow).join(''):empty('Your notes will appear here after you save one.','▤')}</div></div></div>`}
function knowledge(){return `${titleBlock('YOUR KNOWLEDGE','My Knowledge','Save notes, upload exam date sheets and ask questions from your files.',btn('+ New note','new-note',true))}<div class="card document-upload-card"><div><h2>Upload a notice or date sheet</h2><p class="muted">Upload a PDF or image. After extraction, ask about it from the main Ask My Brain page.</p></div><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary upload-label" for="document-upload">＋ Upload PDF / image</label><button class="btn" data-action="go-ask">Ask My Brain ↗</button></div><input id="document-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" multiple hidden><small id="document-upload-status" class="muted">PDF and image files · max 12 MB each</small></div><div class="grid item-grid document-grid">${(data.documents||[]).length?(data.documents||[]).map(d=>`<article class="card document-card"><div class="row"><span class="tag blue">${d.type==='pdf'?'PDF':'Image'}</span><button class="btn small" data-action="ask-document" data-id="${d.id}">Ask AI</button><button class="btn small" data-action="retry-document-ocr" data-id="${d.id}">Re-upload / OCR</button><button class="btn small danger" data-action="delete-document" data-id="${d.id}">Delete</button></div><h3>${esc(d.name)}</h3><p class="muted">${esc(d.extractedText?.length||0)} characters extracted · ${new Date(d.created).toLocaleDateString('en-IN')}</p><details><summary>View extracted text</summary><p class="document-extract">${esc((d.extractedText||'').slice(0,4500))}${(d.extractedText||'').length>4500?'…':''}</p></details></article>`).join(''):`<div class="card" style="grid-column:1/-1">${empty('Your uploaded notices and date sheets will appear here.','📄')}</div>`}</div><div class="toolbar"><input class="search" id="note-search" placeholder="Search notes, subjects, tags…" value="${esc(window.noteQuery||'')}"><select id="subject-filter" class="search" style="max-width:190px"><option value="">All subjects</option>${[...new Set(data.notes.map(n=>n.subject).filter(Boolean))].map(s=>`<option ${window.subjectFilter===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="notes-list" class="grid item-grid">${notesCards()}</div><p class="muted" style="font-size:11px;margin-top:18px">MVP note: notes are saved in your current browser, not synced to an online account.</p>`}
function notesCards(){let q=(window.noteQuery||'').toLowerCase(),s=window.subjectFilter||'';let ns=[...data.notes].filter(n=>(!s||n.subject===s)&&(!q||[n.title,n.content,n.subject,n.tags].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.updated-a.updated);if(!ns.length)return `<div class="card" style="grid-column:1/-1">${empty(q?'No notes match your search.':'No notes yet. Save your first class note or idea.','▤')}${btn('+ Create a note','new-note',true)}</div>`;return ns.map(n=>`<article class="card note-card"><div class="row"><span class="tag blue">${esc(n.subject||'General')}</span><button class="btn small" data-action="edit-note" data-id="${n.id}">Edit</button></div><div class="note-title" style="margin-top:15px">${esc(n.title)}</div><p>${esc(n.content)}</p>${n.attachmentData?`<div class="row" style="margin:8px 0"><small class="muted">📎 ${esc(n.attachmentName||'Attached file')}</small><a class="btn small" href="${n.attachmentData}" download="${esc(n.attachmentName||'attachment')}">Download</a></div>`:''}<div class="row"><small class="muted">${esc(n.tags||'No tags')}</small><button class="btn small danger" data-action="delete-note" data-id="${n.id}">Delete</button></div></article>`).join('')}
function tasks(){const current=today(),monthStart=new Date(current.slice(0,7)+'-01T00:00:00'),daysInMonth=new Date(monthStart.getFullYear(),monthStart.getMonth()+1,0).getDate(),calendarTasks=all.filter(t=>t.due),calendar=Array.from({length:daysInMonth},(_,i)=>{const date=current.slice(0,7)+'-'+String(i+1).padStart(2,'0'),items=calendarTasks.filter(t=>t.due===date);return `<div class="planner-calendar-day ${date===current?'is-today':''}"><b>${i+1}</b>${items.slice(0,3).map(t=>`<button type="button" class="calendar-task ${t.done?'done':''}" data-action="edit-task" data-id="${t.id}" title="Open task: ${esc(t.title)}">${esc(t.title)}</button>`).join('')}${items.length>3?`<small>+${items.length-3} more</small>`:''}</div>`}).join(''),calendarSection=`<section class="planner-calendar-wrap card"><div class="row"><div><div class="eyebrow">MONTH AT A GLANCE</div><h2>${monthStart.toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</h2></div><span class="muted">Tap a task to open it</span></div><div class="planner-calendar-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="planner-calendar-weekday">${d}</div>`).join('')}${Array.from({length:(monthStart.getDay()+6)%7},()=>'<div class="planner-calendar-day is-blank"></div>').join('')}${calendar}</div></section>`;const all=[...(data.tasks||[])].sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;return (a.due||'9999').localeCompare(b.due||'9999')});const open=all.filter(t=>!t.done),done=all.filter(t=>t.done),expanded=window.taskSectionExpanded||'open';const renderGroup=(title,items,key)=>`<section class="card task-accordion"><button class="row task-section-toggle" type="button" data-action="toggle-task-section" data-id="${key}" aria-expanded="${expanded===key}" style="width:100%;border:0;background:transparent;text-align:left;cursor:pointer;padding:0"><h2>${title}</h2><span class="muted">${items.length}</span><span aria-hidden="true">${expanded===key?'▾':'▸'}</span></button>${expanded===key?`<div class="list" style="margin-top:14px">${items.length?items.map(t=>`${taskRow(t)}<div class="task-row-actions"><button class="btn small" data-action="edit-task" data-id="${t.id}">Edit</button> <button class="btn small danger" data-action="delete-task" data-id="${t.id}">Delete</button></div>`).join(''):empty('Nothing here yet. Add a task with a due date.','☑')}</div>`:''}</section>`;return `${titleBlock('YOUR TASKS','Tasks','See your tasks directly, with due dates and quick actions.',btn('+ Add task','new-task',true)+btn('View calendar','go-calendar',false,true))}<div class="planner-summary"><div><b>${open.length}</b><span>Open tasks</span></div><div class="overdue-summary"><b>${open.filter(t=>t.due&&t.due<today()).length}</b><span>Overdue</span></div><div><b>${done.length}</b><span>Completed</span></div></div>${renderGroup('Open tasks',open,'open')}${renderGroup('Completed',done,'completed')}${calendarSection}</div>`;}function planner(){const view=window.plannerView||'Today';const now=today(),tomorrowDate=new Date(now+'T00:00:00');tomorrowDate.setDate(tomorrowDate.getDate()+1);const tomorrow=tomorrowDate.getFullYear()+'-'+String(tomorrowDate.getMonth()+1).padStart(2,'0')+'-'+String(tomorrowDate.getDate()).padStart(2,'0');const open=data.tasks.filter(t=>!t.done),overdue=open.filter(t=>t.due&&t.due<now).sort((a,b)=>a.due.localeCompare(b.due));let tasks=view==='Today'?open.filter(t=>t.due===now):view==='Tomorrow'?open.filter(t=>t.due===tomorrow):view==='Upcoming'?open.filter(t=>!t.due||t.due>tomorrow):view==='Completed'?data.tasks.filter(t=>t.done):[...open].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));const sort=(a,b)=>(a.due||'9999').localeCompare(b.due||'9999');tasks.sort(sort);const tabs=['Today','Tomorrow','Upcoming','Overdue','All','Completed'];const taskHtml=arr=>arr.length?arr.map(t=>`${taskRow(t)}<div class="task-row-actions"><button class="btn small" data-action="edit-task" data-id="${t.id}">Edit</button> <button class="btn small danger" data-action="delete-task" data-id="${t.id}">Delete</button></div>`).join(''):empty('No tasks in this view. Add a task or choose another day.','☑');const calendarTasks=data.tasks.filter(t=>t.due).sort(sort);const calendar=Array.from({length:31},(_,i)=>{const d=new Date(now.slice(0,7)+'-'+String(i+1).padStart(2,'0')+'T00:00:00');if(d.getMonth()!==Number(now.slice(5,7))-1)return '';const date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'),items=calendarTasks.filter(t=>t.due===date);return `<div class="planner-calendar-day ${date===now?'is-today':''} ${items.some(t=>!t.done&&t.due<now)?'has-overdue':''}"><b>${i+1}</b>${items.slice(0,2).map(t=>`<span class="calendar-task ${t.done?'done':''}" title="${esc(t.title)}">${esc(t.title)}</span>`).join('')}${items.length>2?`<small>+${items.length-2} more</small>`:''}</div>`}).join('');return `${titleBlock('STAY ON TRACK','Daily planner','Today, tomorrow, upcoming deadlines and your monthly calendar.',btn('+ Add task','new-task',true)+btn('Enable reminders','enable-reminders',false,true))}<div class="planner-summary"><div><b>${open.length}</b><span>Open tasks</span></div><div class="overdue-summary"><b>${overdue.length}</b><span>Overdue</span></div><div><b>${data.tasks.filter(t=>t.done).length}</b><span>Completed</span></div></div><div class="planner-tabs" role="tablist" aria-label="Task views">${tabs.map(x=>`<button class="planner-tab ${view===x?'active':''} ${x==='Overdue'&&overdue.length?'has-count':''}" data-action="planner-view" data-id="${x}" role="tab" aria-selected="${view===x}">${x}${x==='Overdue'&&overdue.length?` <span>${overdue.length}</span>`:''}</button>`).join('')}</div><div class="planner-view-heading"><h2>${view} tasks</h2><span class="muted">${tasks.length} task${tasks.length===1?'':'s'}</span></div><div class="card planner-task-list"><div class="list">${taskHtml(tasks)}</div></div><section class="planner-calendar-wrap"><div class="row"><div><div class="eyebrow">MONTH AT A GLANCE</div><h2>${new Date(now.slice(0,7)+'-01T00:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</h2></div><span class="muted">Deadlines marked below</span></div><div class="planner-calendar-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="planner-calendar-weekday">${d}</div>`).join('')}${Array.from({length:(new Date(now.slice(0,7)+'-01T00:00:00').getDay()+6)%7},()=>'<div class="planner-calendar-day is-blank"></div>').join('')}${calendar}</div></section>${overdue.length&&view!=='Overdue'?`<section class="overdue-panel"><div class="row"><h2>Needs attention · Overdue</h2><button class="btn small" data-action="planner-view" data-id="Overdue">View all</button></div><div class="list">${overdue.slice(0,3).map(taskRow).join('')}</div></section>`:''}`}function studyPlanner(){const sessions=[...(data.studySessions||[])].sort((a,b)=>(a.date||'').localeCompare(b.date||''));return `${titleBlock('STUDY ROUTINE','Study planner','Plan study blocks by subject, date and duration.',btn('+ Add study session','new-study',true))}<div class="card"><div class="list">${sessions.length?sessions.map(x=>`<div class="list-item"><div class="list-icon">📚</div><div class="list-copy"><b>${esc(x.subject)}</b><small>${dateFmt(x.date)} · ${esc(x.duration||'')}${x.duration?' min':''} · ${esc(x.topic||'')}</small></div><button class="btn small danger" data-action="delete-study" data-id="${x.id}">Remove</button></div>`).join(''):empty('No study sessions planned yet.','📚')}</div></div>`}
function backupRestore(){return `${titleBlock('YOUR DATA','Backup & restore','Download a backup or restore a previous Student Brain JSON file.') }<div class="grid two-col"><div class="card"><h2>Backup</h2><p class="muted">Export your notes, tasks, study sessions, attachments and workspace data.</p>${btn('Download backup','export-data',true)}</div><div class="card"><h2>Restore</h2><p class="muted">Select a Student Brain backup. Restoring replaces current data.</p><input id="restore-file" type="file" accept=".json,application/json" class="search"><div style="margin-top:12px">${btn('Restore backup','restore-data')}</div></div><div class="card" style="grid-column:1/-1"><h2>Cloud sync</h2><p class="muted">Your workspace is currently stored in this browser. To enable shared, multi-device sync, we need to connect a database and configure secure access rules.</p><span class="tag amber">Cloud connection not configured</span></div></div>`}
function projects(){return `${titleBlock('YOUR WORKSPACES','Projects','Keep project notes, tasks and milestones connected.',btn('+ New project','new-project',true))}<div class="grid item-grid">${data.projects.length?[...data.projects].sort((a,b)=>b.updated-a.updated).map(projectCard).join(''):`<div class="card" style="grid-column:1/-1">${empty('No projects yet. Create one for your semester project, hackathon or personal idea.','▣')}${btn('+ Create project','new-project',true)}</div>`}</div>`}
function expenseStat(label,num,note,icon,kind){return '<button type="button" class="card stat-card expense-quick-action" data-action="expense-quick-action" data-id="'+kind+'" title="'+(kind==='all'?'View all records':'Quick add')+'"><span class="row"><span class="stat-label">'+label+'</span><span class="stat-icon">'+icon+'</span></span><span class="stat-number">'+num+'</span><span class="stat-note">'+note+'<span class="stat-open-hint"> · '+(kind==='all'?'View all →':'Quick add +')+'</span></span></button>'}
function expenses(){const month=window.expenseMonth||today().slice(0,7),es=[...data.expenses].filter(e=>!month||e.date?.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date)),kind=e=>e.kind||'expense',sum=k=>es.filter(e=>kind(e)===k).reduce((n,e)=>n+Number(e.amount||0),0),spent=sum('expense'),lent=sum('lent')-sum('lent_repayment'),borrowed=sum('borrowed')-sum('borrowed_repayment'),moneyRows=es.filter(e=>kind(e)!=='expense');return `${titleBlock('STUDENT BUDGET','Money & Udhaar','Track daily spending, money lent or borrowed, and repayments.',btn('+ Add transaction','new-expense',true))}<div class="grid stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">${expenseStat('Spending this month',money(spent),month||'All records','₹','expense')}${expenseStat('You are owed',money(lent),'Lent less received repayments','↗','lent')}${expenseStat('You owe others',money(borrowed),'Borrowed less repayments','↙','borrowed')}${expenseStat('Records',es.length,'Expenses + udhaar entries','₹','all')}</div><div class="toolbar"><input id="expense-month" type="month" class="search" style="max-width:210px" value="${esc(month)}">${btn('Show all','all-expenses')}</div><div class="card"><div class="list">${es.length?es.map(e=>`<div class="list-item"><div class="list-icon">₹</div><div class="list-copy"><b>${esc(e.description)}</b><small>${esc(({expense:'Expense',lent:'Lent',borrowed:'Borrowed',lent_repayment:'Received repayment',borrowed_repayment:'Repaid'}[kind(e)]||'Transaction'))}${e.person?' · '+esc(e.person):''} · ${esc(e.category||'Other')} · ${dateFmt(e.date)}</small></div><b>${money(e.amount)}</b><button class="btn small" data-action="edit-expense" data-id="${e.id}">Edit</button><button class="btn small danger" data-action="delete-expense" data-id="${e.id}">×</button></div>`).join(''):empty('No transactions for this month. Add your first record.','₹')}</div></div>`}
function ask(){return `<div class="chat-shell"><div class="chat-intro"><div class="brain-icon">✧</div><div class="eyebrow">YOUR PERSONAL AI</div><h2>Ask your Brain</h2><p>Ask about your notes, uploaded PDFs/images, tasks, or your money and udhaar ledger.</p><span class="tag green">AI answers grounded in your saved knowledge</span><div class="suggestions"><button class="suggestion" data-question="Summarize my notes">Summarize my notes</button><button class="suggestion" data-question="What subjects have I saved?">What subjects have I saved?</button><button class="suggestion" data-question="What should I work on next?">What should I work on next?</button><button class="suggestion" data-question="Who owes me money?">Who owes me money?</button><button class="suggestion" data-question="How much do I owe others?">How much do I owe others?</button></div></div><div class="chat-messages" id="chat-messages">${data.messages.map(m=>`<div class="bubble ${m.role==='user'?'user':'assistant'}">${formatChatText(m.content)}${m.sources?.length?`<span class="source">Sources: ${m.sources.map(esc).join(', ')}</span>`:''}</div>`).join('')||`<div class="bubble assistant">Hi! Ask me about your saved notes or uploaded PDF/image files. I’ll read relevant content, explain it in natural language, and show the source.</div>`}</div>${chatBusy?'<div class="bubble assistant typing-indicator" role="status" aria-live="polite"><span>Typing</span><span class="typing-dots" aria-hidden="true">...</span></div>':''}<form class="chat-form" id="chat-form"><input id="chat-input" placeholder="Ask about your saved notes or uploaded files…" autocomplete="off"><button class="btn primary" type="submit" ${chatBusy?'disabled':''}>${chatBusy?'Thinking…':'Send ↗'}</button></form><div class="chat-note">Ask naturally about your saved files, notes and workspace. Brain uses relevant passages and provides source labels. Selected document excerpts/original files are sent to Google Gemini for AI answers; free-tier content may be used to improve Google products. Avoid sensitive uploads.</div></div>`}
function personalMemory(){const memories=data.memories||[];return `${titleBlock('PERSONAL MEMORY','Personal memory','Save preferences and useful facts. Ask My Brain can use them alongside your notes and uploaded documents.',btn('+ Add memory','new-memory',true))}<div class="card memory-explainer"><h2>Your Brain remembers what matters</h2><p class="muted">Examples: preferred language, learning style, course goals, formatting preferences, or recurring context. Only add details you want saved in this browser.</p></div><div class="grid item-grid">${memories.length?memories.map(m=>`<article class="card memory-card"><div class="row"><span class="tag blue">${esc(m.category||'Preference')}</span><button class="btn small" data-action="edit-memory" data-id="${m.id}">Edit</button></div><h3>${esc(m.title)}</h3><p>${esc(m.content)}</p><div class="row"><small class="muted">Saved ${dateFmt(m.date||today())}</small><button class="btn small danger" data-action="delete-memory" data-id="${m.id}">Delete</button></div></article>`).join(''):`<div class="card" style="grid-column:1/-1">${empty('No personal memories yet. Add a preference or useful fact to help Brain tailor its answers.','✧')}</div>`}</div><p class="muted" style="font-size:11px;margin-top:15px">Memory is stored locally on this device and included in your workspace backup.</p>`}
function settings(){return `${titleBlock('PREFERENCES','Settings','Manage your workspace and data safety.')}<div class="grid two-col"><div class="card"><h2>Workspace</h2><div class="list-item"><div class="list-icon">✦</div><div class="list-copy"><b>Student Brain</b><small>Personal student workspace</small></div><span class="tag green">Ready</span></div><p class="muted" style="font-size:12px;line-height:1.7;margin-top:15px">Your data is stored in this browser. Export regular backups to keep a copy.</p></div><div class="card"><h2>Data controls</h2><p class="muted" style="font-size:12px;line-height:1.7">Download a backup before clearing local data.</p><div class="actions">${btn('Export my data ↓','export-data',true)}${btn('Clear all data','clear-data')}</div></div></div>`}function modal(title,body,saveLabel='Save'){document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>${title}</h2><button type="button" class="xbtn" data-action="close-modal" aria-label="Close dialog">×</button></div><form id="edit-form">${body}<div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">${saveLabel}</button></div></form></div></div>`}
function field(label,name,value='',type='text',opts={}){let val=esc(value??'');if(type==='textarea')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><textarea name="${name}" ${opts.required?'required':''} placeholder="${esc(opts.placeholder||'')}">${val}</textarea></div>`;if(type==='select')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><select name="${name}">${opts.options.map(o=>{const parts=String(o).split('|'),v=parts.length>1?parts.shift():String(o),text=parts.length?parts.join('|'):String(o);return `<option value="${esc(v)}" ${v===String(value??'')?'selected':''}>${esc(text)}</option>`}).join('')}</select></div>`;return `<div class="field ${opts.full?'full':''}"><label>${label}</label><input name="${name}" type="${type}" value="${val}" ${opts.required?'required':''} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.accept?`accept="${esc(opts.accept)}"`:''} placeholder="${esc(opts.placeholder||'')}"></div>`}
let editing=null,formType='';
function openMemoryForm(id){const item=id?(data.memories||[]).find(x=>x.id===id)||{}:{};editing=id||null;formType='memory';const body=field('Memory title','title',item.title,'text',{required:true,full:true,placeholder:'e.g. Preferred answer language'})+field('Type','category',item.category||'Preference','select',{options:['Preference','Personal context','Learning goal','Communication style','Other']})+field('Memory','content',item.content,'textarea',{required:true,full:true,placeholder:'e.g. Explain technical concepts in simple Hinglish with examples.'});modal(id?'Edit memory':'Add personal memory',body,id?'Save changes':'Save memory');}
function openForm(type,id){editing=id||null;formType=type;let obj=id?data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'].find(x=>x.id===id)||{}:{};let body='';
if(type==='note')body=(id?'':field('Attach PDF / image (up to 12 MB)','attachment','', 'file',{full:true,accept:'.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff'}))+field('Title','title',obj.title,'text',{full:true})+field('Subject','subject',obj.subject,'text',{placeholder:'e.g. Data Structures'})+field('Tags','tags',obj.tags,'text',{placeholder:'e.g. exam, unit 2'})+field('Content','content',obj.content,'textarea',{full:true,placeholder:'Write or paste your notes here… (optional if attaching a file)'});
if(type==='task')body=field('Task title','title',obj.title,'text',{required:true,full:true})+field('Subject / category','category',obj.category||'Assignment')+field('Due date','due',obj.due,'date')+field('Reminder time','reminderTime',obj.reminderTime||'09:00','time')+field('Priority','priority',obj.priority||'Medium','select',{options:['Low','Medium','High']})+field('Related project','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)].map(x=>x.includes('|')?x:x),full:true})+field('Notes','notes',obj.notes,'textarea',{full:true});
if(type==='study')body=field('Subject','subject','','text',{required:true,full:true})+field('Topic / chapter','topic','','text',{full:true})+field('Date','date',today(),'date',{required:true})+field('Duration (minutes)','duration','45','number',{required:true,min:1});
if(type==='project')body=field('Project name','name',obj.name,'text',{required:true,full:true})+field('Description','description',obj.description,'textarea',{full:true})+field('Status','status',obj.status||'In progress','select',{options:['In progress','On hold','Completed']})+field('Target date','targetDate',obj.targetDate,'date');
if(type==='expense')body=field('Transaction type','kind',obj.kind||'expense','select',{options:['expense|Expense / spending','lent|I lent money','borrowed|I borrowed money','lent_repayment|Money returned to me','borrowed_repayment|I repaid money']})+field('Description','description',obj.description,'text',{required:true,full:true})+field('Person','person',obj.person||'','text',{full:true,placeholder:'Name of person (optional for expense)'})+field('Amount (₹)','amount',obj.amount,'number',{required:true,min:0})+field('Category','category',obj.category||'Food','select',{options:['Food','Travel','Books & supplies','College fees','Entertainment','Shopping','Other','Udhaar','Repayment']})+field('Date','date',obj.date||today(),'date',{required:true})+field('Related project (optional)','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)] .map(x=>x.includes('|')?x:x),full:true});
const arr=data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'];const old=obj.projectId||'';body=body.replaceAll('value="'+esc(old)+'"','value="'+esc(old)+'"');
modal((id?'Edit ':'New ')+({note:'note',task:'task',study:'study session',project:'project',expense:'expense'}[type]),body,id?'Save changes':'Create');const firstField=document.querySelector('#edit-form input:not([type=file]),#edit-form textarea,#edit-form select');if(firstField){firstField.removeAttribute('readonly');firstField.removeAttribute('disabled');firstField.focus();}}
async function saveForm(e){e.preventDefault();const fd=new FormData(e.target),v=Object.fromEntries(fd.entries()),key=formType==='note'?'notes':formType==='task'?'tasks':formType==='project'?'projects':'expenses';if(formType==='memory'){data.memories=data.memories||[];const record=editing?data.memories.find(x=>x.id===editing):null;if(record)Object.assign(record,v,{date:today(),updated:Date.now()});else data.memories.push({id:uid(),...v,date:today(),created:Date.now()});persist();document.querySelector('#modal-root').innerHTML='';page='memory';render();toast(editing?'Memory updated':'Memory saved');return}if(formType==='note'){delete v.attachment;const file=e.target.querySelector('input[name=attachment]')?.files?.[0];if(!String(v.title||'').trim()&&file)v.title=file.name;if(!file&&!String(v.content||'').trim()){toast('Attach a PDF/image or enter note content');return}if(!String(v.title||'').trim()){toast('Please enter a title');return}if(file){e.target._quickUploadFile=file;if(file.size>12*1024*1024){toast('File limit is 12 MB');return}if(!(file.type==='application/pdf'||file.type.startsWith('image/'))){toast('Please choose a PDF or image');return}try{v.attachmentName=file.name;v.attachmentType=file.type||'application/octet-stream';v.attachmentData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)})}catch(_){toast('Could not read this file');return}}}if(['task','expense'].includes(formType)&&v.projectId?.includes('|'))v.projectId=v.projectId.split('|')[0];if(!v.projectId)delete v.projectId;if(formType==='study'){data.studySessions=data.studySessions||[];data.studySessions.push({id:uid(),...v,created:Date.now()});persist();document.querySelector('#modal-root').innerHTML='';render();toast('Study session planned');return}if(formType==='expense'&&(!Number.isFinite(Number(v.amount))||Number(v.amount)<=0)){toast('Enter a valid amount');return}if(formType==='expense'){v.kind=v.kind||'expense';if(v.kind!=='expense'&&!String(v.person||'').trim()){toast('Enter the person name for lending or repayment');return}}let obj=editing?data[key].find(x=>x.id===editing):null;if(obj)Object.assign(obj,v,{updated:Date.now()});else data[key].push({id:uid(),...v,done:false,updated:Date.now(),created:Date.now()});persist();document.querySelector('#modal-root').innerHTML='';render();toast(editing?'Changes saved':'Created successfully');if(formType==='note'&&e.target._quickUploadFile){const savedNote=data.notes.find(n=>n.id===editing)||data.notes[data.notes.length-1];await processUploadedDocuments([e.target._quickUploadFile],savedNote?.id||null);e.target._quickUploadFile=null}}
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
 let best=await recognize(file);
 // Try a grayscale/high-contrast enlarged pass when the first OCR is sparse.
 if(best.trim().length<40&&window.createImageBitmap){
  const bitmap=await createImageBitmap(file),scale=Math.min(2,2200/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),d=pixels.data;
  for(let i=0;i<d.length;i+=4){const gray=.299*d[i]+.587*d[i+1]+.114*d[i+2],v=gray>160?255:0;d[i]=d[i+1]=d[i+2]=v}
  ctx.putImageData(pixels,0,0);const improved=await recognize(canvas);if(improved.trim().length>best.trim().length)best=improved;
  bitmap.close?.();
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
  if(!isPdf&&!file.type.startsWith('image/')&&!/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name)){setStatus('Unsupported file type. Upload a PDF or image.');toast('Unsupported file type');continue}
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
   data.documents.push({id,name:file.name,type:isPdf?'pdf':'image',mimeType:file.type||'',size:file.size,extractedText,chunks:splitDocumentIntoChunks(extractedText),created:Date.now(),sourceNoteId:sourceNoteId||null,sourceKind:sourceNoteId?'note-attachment':'uploaded-file',fileStored});
   persist();render();setProgress(100,'Saved '+file.name+'. Ask Brain can use extracted text'+(fileStored?' and original file.':'.'));toast('File saved to My Knowledge');
  }catch(err){console.error('Document extraction failed',err);setStatus('Could not read '+file.name+': '+(err.message||'unknown error'));toast('Extraction failed. See upload status.')}
 }
}


function askDocument(id){
 const doc=(data.documents||[]).find(d=>d.id===id);if(!doc)return;
 const q=prompt('Ask Brain anything about '+doc.name);
 if(!q||!q.trim())return;
 page='ask';render();sendChat(q.trim(),id);
}

function splitDocumentIntoChunks(text){
 const pages=String(text||'').split(/(?=\[Page\s+\d+\])/i),chunks=[];
 pages.forEach(page=>{
  const match=page.match(/^\[Page\s+(\d+)\]/i),pageNumber=match?Number(match[1]):null;
  const lines=page.replace(/^\[Page\s+\d+\]\s*/i,'').split(/\n+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  let block=[];
  const flush=()=>{if(block.length){chunks.push({text:block.join(' '),page:pageNumber});block=[]}};
  lines.forEach(line=>{if(block.length&&(/^[A-Z0-9][A-Z0-9\s:()/-]{2,}$/.test(line)||block.join(' ').length+line.length>850))flush();block.push(line);if(block.join(' ').length>=500)flush()});
  flush();
 });
 return chunks;
}
function extractTimetableData(text){
 const records=[];
 const lines=String(text||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
 const parseTime=s=>{const m=String(s||'').match(/(\d{1,2}:\d{2}\s*[AP]M)/i);return m?m[1].toUpperCase().replace(/\s+/g,' '):''};
 for(const line of lines){
  const m=line.match(/\b(All\s+)?(AEC|VAC|SEC|Open\s+Elective(?:\s+Courses)?)\s*[-:–—]\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})\s*(?:\(([^)]+)\))?\s*[-:–—]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[-:–—]\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if(m)records.push({course:m[2].replace(/\s+/g,' ').trim().toUpperCase().replace('OPEN ELECTIVE COURSES','OPEN ELECTIVE'),date:m[3].replace(/[/-]/g,'.'),day:m[4]||'',start:parseTime(m[5]),end:parseTime(m[6]),raw:line});
 }
 return records;
}

const AI_STOP_WORDS=new Set(['what','when','where','which','does','this','that','from','with','tell','show','about','please','the','and','for','are','was','is','in','on','of','your','have','could','should','would','can','find','search','me','my','brain','ask','file','uploaded','document','date','exam','paper','test','hai','kya','bata','do','or','to','a','an','as','at','by','it','be','summarize','summary','explain']);
function aiQueryTerms(question){
 return [...new Set(String(question||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\u0900-\u097f\s]/g,' ').split(/\s+/).filter(w=>w.length>1&&!AI_STOP_WORDS.has(w)))].slice(0,18);
}
function aiTextScore(text,terms){
 if(!terms.length)return 0;
 const lower=String(text||'').toLowerCase();let score=0;
 for(const term of terms)if(lower.includes(term))score+=lower.split(term).length>2?2:1;
 return score/Math.sqrt(terms.length);
}
async function buildStudentBrainAIRequest(question,targetDocId=null){
 const terms=aiQueryTerms(question),allDocs=(data.documents||[]).filter(doc=>doc&&doc.id);
 // Search every uploaded document first; retrieval is not limited to the top few files.
 const docCandidates=allDocs.map(doc=>{
  const chunks=(Array.isArray(doc.chunks)&&doc.chunks.length?doc.chunks:splitDocumentIntoChunks(doc.extractedText||''))
   .map((chunk,index)=>({text:String(chunk.text||''),page:chunk.page??null,index,score:aiTextScore(chunk.text,terms)}))
   .filter(chunk=>chunk.text.trim());
  const docScore=aiTextScore((doc.name||'')+' '+(doc.extractedText||''),terms);
  return {doc,docScore,chunks};
 }).filter(item=>!targetDocId||item.doc.id===targetDocId);
 const perDoc=[];
 for(const item of docCandidates){
  const relevant=item.chunks.filter(chunk=>!terms.length||chunk.score>0)
   .sort((a,b)=>b.score-a.score||a.index-b.index);
  // When a query has matches, only include matching passages. If no match exists,
  // preserve a small sample so the model can explain that evidence was not found.
  const picked=relevant.length?relevant.slice(0,targetDocId?24:4):item.chunks.slice(0,1);
  if(picked.length)perDoc.push({...item,picked});
 }
 const globalRanked=perDoc.flatMap(item=>item.picked.map(chunk=>({...chunk,doc:item.doc,docScore:item.docScore})))
  .sort((a,b)=>b.score-a.score||b.docScore-a.docScore||a.index-b.index);
 const selected=[],seen=new Set();
 // First pass: retain at least one relevant passage from every file that matched.
 for(const item of perDoc){
  const first=item.picked[0];
  if(first){selected.push({...first,doc:item.doc});seen.add(item.doc.id)}
 }
 // Second pass: fill remaining context with the strongest passages across all files.
 for(const hit of globalRanked){
  if(selected.length>=32)break;
  if(selected.some(item=>item.doc.id===hit.doc.id&&item.index===hit.index))continue;
  selected.push(hit);
 }
 const documents=[],sources=[];let totalChars=0,inlineFile=null;
 for(const hit of selected){
  const doc=hit.doc;const label='File: '+doc.name+(hit.page?' · Page '+hit.page:'');
  const block='['+label+']\\n'+hit.text;
  if(totalChars+block.length>39000)continue;
  let target=documents.find(entry=>entry.id===doc.id);
  if(!target){target={id:doc.id,name:doc.name,type:doc.type||'file',content:''};documents.push(target)}
  target.content+=(target.content?'\\n\\n':'')+block;
  totalChars+=block.length;
  if(!sources.includes(label))sources.push(label);
 }
 // Keep original visual-file analysis as an optional enhancement, while all uploaded
 // files participate in text retrieval and cross-file synthesis.
 const visualCandidates=docCandidates.filter(item=>item.doc.fileStored&&Number(item.doc.size||0)<=3*1024*1024&&
  (targetDocId||item.docScore>0)&&/^(application\/pdf|image\/(png|jpeg|webp))$/i.test(item.doc.mimeType||''));
 for(const item of visualCandidates.slice(0,1)){
  try{
   const saved=await getOriginalDocument(item.doc.id);
   if(saved?.blob){
    inlineFile={name:item.doc.name,mimeType:saved.type||item.doc.mimeType||'application/pdf',dataBase64:await fileToBase64(saved.blob)};
    const label='File: '+item.doc.name+' · original file';if(!sources.includes(label))sources.push(label);
   }
  }catch(error){console.warn('Original file is not available for visual AI analysis.',error)}
 }
 const rankedNotes=(data.notes||[]).map(note=>({note,score:aiTextScore([note.title,note.subject,note.tags,note.content].join(' '),terms)})).sort((a,b)=>b.score-a.score||Number(b.note.updated||0)-Number(a.note.updated||0));
 const notes=rankedNotes.filter(item=>!terms.length||item.score>0).slice(0,10).map(({note})=>{
  const source='Note: '+(note.title||'Untitled note');sources.push(source);
  return {source,title:String(note.title||''),subject:String(note.subject||''),tags:String(note.tags||''),content:String(note.content||'').slice(0,2400)};
 });
 const tasks=(data.tasks||[]).slice(0,60).map(task=>{const source='Task: '+String(task.title||'Untitled task');sources.push(source);return {source,title:task.title||'',category:task.category||'',due:task.due||null,priority:task.priority||'Medium',completed:!!task.done,notes:String(task.notes||'').slice(0,500)}});
 const projects=(data.projects||[]).slice(0,20).map(project=>{const source='Project: '+String(project.name||project.title||'Untitled project');sources.push(source);return {source,name:project.name||project.title||'',description:String(project.description||'').slice(0,700),status:project.status||'In progress',targetDate:project.targetDate||null}});
 const memories=(data.memories||[]).slice(0,20).map(memory=>{const source='Personal memory: '+String(memory.title||'Memory');sources.push(source);return {source,title:memory.title||'',category:memory.category||'',content:String(memory.content||'').slice(0,700)}});
 const studySessions=(data.studySessions||[]).slice(-15).map(session=>Object.fromEntries(Object.entries(session||{}).filter(([key,value])=>!['id','created','updated'].includes(key)&&value!==null&&value!==undefined)));if(studySessions.length)sources.push('Study sessions');
 const expenses=(data.expenses||[]).slice(-40).map(expense=>({description:expense.description||'',category:expense.category||'',person:expense.person||'',kind:expense.kind||'expense',amount:expense.amount||0,date:expense.date||''}));if(expenses.length)sources.push('Money & Udhaar');
 return {workspace:{today:today(),notes,tasks,projects,memories,studySessions,expenses,documents},sources:[...new Set(sources)].slice(0,40),inlineFile};
}
async function requestStudentBrainAI(question,targetDocId=null){
 const token=await getStudentBrainAIToken(),context=await buildStudentBrainAIRequest(question,targetDocId);
 const body={message:question,workspace:context.workspace,allowedSources:context.sources,inlineFile:context.inlineFile};
 const response=await fetch(CLOUD_URL+'/functions/v1/student-brain-ai',{
  method:'POST',
  headers:{'Content-Type':'application/json','apikey':CLOUD_KEY,'Authorization':'Bearer '+token},
  body:JSON.stringify(body)
 });
 let result={};try{result=await response.json()}catch{}
 if(!response.ok)throw new Error(result.error||('AI request failed ('+response.status+').'));
 if(typeof result.answer!=='string'||!result.answer.trim())throw new Error('AI returned an empty answer. Please try again.');
 return {answer:result.answer.trim(),sources:Array.isArray(result.sources)?result.sources.filter(source=>typeof source==='string').slice(0,20):[]};
}
function isStructuredWorkspaceQuestion(question){
 return /\b(spend|spent|spending|expense|expenses|money|kharch|kharcha|transaction|transactions|budget|udhaar|lent|lending|borrow|borrowed|loan|repay|repaid|repayment|outstanding|owe|owed|who owes|task|tasks|todo|to-do|pending|unfinished|incomplete|overdue|deadline|reminder|remind me|planner)\b/i.test(question);
}
function aiAnswer(question){
 const raw=String(question||''),terms=aiQueryTerms(raw);
 if(/\b(spend|spent|expense|expenses|money|kharch|udhaar|lent|borrowed|owe|repaid)\b/i.test(raw)){
  const expenses=data.expenses||[],fmt=n=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
  const total=expenses.filter(e=>(e.kind||'expense')==='expense').reduce((sum,e)=>sum+Number(e.amount||0),0);
  const lent=expenses.filter(e=>e.kind==='lent').reduce((sum,e)=>sum+Number(e.amount||0),0)-expenses.filter(e=>e.kind==='lent_repayment').reduce((sum,e)=>sum+Number(e.amount||0),0);
  const borrowed=expenses.filter(e=>e.kind==='borrowed').reduce((sum,e)=>sum+Number(e.amount||0),0)-expenses.filter(e=>e.kind==='borrowed_repayment').reduce((sum,e)=>sum+Number(e.amount||0),0);
  return {answer:'Saved records show expenses of '+fmt(total)+', people owe you '+fmt(lent)+', and you owe others '+fmt(borrowed)+'. These totals use your saved Money & Udhaar records.',sources:['Money & Udhaar']};
 }
 if(/\b(task|tasks|todo|to-do|pending|overdue|deadline|planner)\b/i.test(raw)){
  const tasks=(data.tasks||[]).filter(t=>!t.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  return {answer:tasks.length?'Your pending tasks:\n'+tasks.slice(0,15).map((t,i)=>(i+1)+'. '+t.title+' — '+(t.due?(t.due<today()?'OVERDUE · ':'Due ')+dateFmt(t.due):'No due date')+' · '+(t.priority||'Medium')).join('\n'):'You have no pending tasks saved right now.',sources:['Tasks & Planner']};
 }
 const hits=[];
 (data.documents||[]).forEach(doc=>{
  const chunks=(Array.isArray(doc.chunks)&&doc.chunks.length?doc.chunks:splitDocumentIntoChunks(doc.extractedText||''));
  chunks.forEach(chunk=>{const text=String(chunk.text||'');const score=aiTextScore(text,terms);if(score>0)hits.push({text,score,source:'File: '+doc.name+(chunk.page?' · Page '+chunk.page:'')})});
 });
 (data.notes||[]).forEach(note=>{const text=[note.title,note.subject,note.tags,note.content].filter(Boolean).join(' '),score=aiTextScore(text,terms);if(score>0)hits.push({text,score,source:'Note: '+(note.title||'Untitled note')})});
 (data.memories||[]).forEach(memory=>{const text=[memory.title,memory.category,memory.content].filter(Boolean).join(' '),score=aiTextScore(text,terms);if(score>0)hits.push({text,score,source:'Personal memory: '+(memory.title||'Memory')})});
 hits.sort((a,b)=>b.score-a.score);
 const selected=hits.slice(0,5);
 return selected.length?{answer:selected.map((hit,index)=>(index+1)+'. '+hit.text).join('\n\n'),sources:[...new Set(selected.map(hit=>hit.source))]}:{answer:'I could not find matching saved content. Try mentioning a course name, keyword, or phrase from your file. When AI is connected, Brain can explain the relevant content in natural language.',sources:[]};
}
function chatActionIntent(question){
 const raw=String(question||'').trim(),lower=raw.toLowerCase();
 const addTask=/\b(?:add|create|make|remind me|schedule|bana do|banao|add kar)\b/i.test(lower)&&/\b(?:task|todo|assignment|deadline|homework|exam|submit)\b/i.test(lower);
 if(addTask){
  let title=raw.replace(/\b(?:please|add|create|make|remind me to|remind me|schedule|bana do|banao|add kar do|add kar|a|an|the|task|todo|assignment|deadline|homework|exam|submit|due|today|tomorrow|kal|aaj|on|by)\b/ig,' ').replace(/\s+/g,' ').trim();
  if(!title)return {answer:'Task ka naam bhi batao. Example: Add DSA assignment due tomorrow.',sources:['Planner']};
  let due='';
  if(/\b(?:tomorrow|kal)\b/i.test(lower)){const d=new Date();d.setDate(d.getDate()+1);due=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  else if(/\b(?:today|aaj)\b/i.test(lower))due=today();
  const task={id:uid(),title,category:/assignment|submit/i.test(lower)?'Assignment':/exam/i.test(lower)?'Exam':'Personal',due,priority:/urgent|important|high priority/i.test(lower)?'High':'Medium',done:false,created:Date.now(),updated:Date.now()};
  data.tasks.push(task);persist();return {answer:'Task added: '+title+(due?' · Due '+dateFmt(due):' · No due date set')+'.',sources:['Planner']};
 }
 const complete=/\b(?:complete|finish|mark)\b/i.test(lower)&&/\b(?:task|assignment|todo|done)\b/i.test(lower);
 if(complete){
  const needle=raw.replace(/\b(?:please|complete|finish|mark|as|done|task|the|my|todo)\b/ig,' ').trim().toLowerCase();
  const found=(data.tasks||[]).filter(t=>!t.done&&needle&&String(t.title||'').toLowerCase().includes(needle));
  if(found.length===1){found[0].done=true;found[0].updated=Date.now();persist();return {answer:'Marked "'+found[0].title+'" as completed.',sources:['Planner']}}
  return {answer:found.length?'I found multiple tasks. Mention a more specific task title.':'I could not find that task. Please use its saved title.',sources:['Planner']};
 }
 return null;
}

async function sendChat(question,targetDocId=null){
 const query=String(question||'').trim();if(!query||chatBusy)return;
 data.messages.push({role:'user',content:query});persist();
 const actionResult=chatActionIntent(query);
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

function action(name,id){const map={ 'open-quick-add':()=>openQuickAdd(),'quick-add-upload':()=>document.querySelector('#quick-add-file-upload')?.click(),'new-note':()=>openForm('note'),'new-memory':()=>openMemoryForm(),'edit-memory':()=>openMemoryForm(id),'delete-memory':()=>{if(confirm('Delete this saved memory?')){data.memories=(data.memories||[]).filter(m=>m.id!==id);persist();render();toast('Memory deleted')}},'go-memory':()=>{page='memory';render()},'voice-quick-command':()=>{if(window.startStudentBrainListening)window.startStudentBrainListening();else toast('Voice assistant is loading. Try again.');},'edit-note':()=>openForm('note',id),'delete-note':()=>confirmDelete('notes',id),'delete-document':()=>{removeOriginalDocument(id);data.documents=(data.documents||[]).filter(d=>d.id!==id);persist();render();toast('Document deleted')},'retry-document-ocr':()=>retryDocumentOCR(id),'ask-document':()=>askDocument(id),'new-task':()=>openForm('task'),'enable-reminders':()=>enableTaskReminders(),'new-study':()=>openForm('study'),'edit-task':()=>openForm('task',id),'delete-task':()=>confirmDelete('tasks',id),'new-project':()=>openForm('project'),'edit-project':()=>openForm('project',id),'new-expense':()=>openForm('expense'),'expense-quick-action':()=>{if(id==='all'){window.expenseMonth='';render();return}openForm('expense');const typeField=document.querySelector('#edit-form [name=kind]');if(typeField){typeField.value=id;typeField.dispatchEvent(new Event('change',{bubbles:true}))}const descriptionField=document.querySelector('#edit-form [name=description]');if(descriptionField){descriptionField.focus();descriptionField.setSelectionRange?.(0,descriptionField.value.length)}const categoryField=document.querySelector('#edit-form [name=category]');if(categoryField&&id.includes('repayment'))categoryField.value='Repayment';const personField=document.querySelector('#edit-form [name=person]');if(personField&&id!=='expense')personField.placeholder='Who was the money for/from?'},'edit-expense':()=>openForm('expense',id),'delete-expense':()=>confirmDelete('expenses',id),'delete-study':()=>{data.studySessions=(data.studySessions||[]).filter(x=>x.id!==id);persist();render();toast('Study session removed')},'planner-view':()=>{window.plannerView=id;render()},'go-ask':()=>{page='ask';render()},'toggle-task-section':()=>{window.taskSectionExpanded=(window.taskSectionExpanded||'open')===id?'':id;render();},'go-planner':()=>{page='planner';render()},'go-knowledge':()=>{page='knowledge';render()},'toggle-task':()=>{let t=data.tasks.find(x=>x.id===id);if(!t)return;t.done=!t.done;persist();render();toast(t.done?'Task marked complete':'Task moved back to open tasks')},'all-expenses':()=>{window.expenseMonth='';render()},'export-data':()=>exportData(),'restore-data':()=>restoreData(),'clear-data':()=>clearData(),'close-modal':()=>document.querySelector('#modal-root').innerHTML=''};map[name]?.()}
function confirmDelete(key,id){const item=data[key].find(x=>x.id===id);if(!item)return;if(confirm(`Delete "${item.title||item.name||item.description}"? This cannot be undone.`)){data[key]=data[key].filter(x=>x.id!==id);persist();render();toast('Deleted')}}
function restoreData(){const f=document.querySelector('#restore-file')?.files?.[0];if(!f){toast('Choose a JSON backup first');return}const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed||!Array.isArray(parsed.notes)||!Array.isArray(parsed.tasks))throw Error('Invalid backup');if(!confirm('Restore this backup and replace current workspace data?'))return;data={...starter(),...parsed};persist();page='overview';render();toast('Backup restored')}catch(e){toast('Invalid Student Brain backup file')}};reader.readAsText(f)}
function exportData(){try{const payload={app:'Student Brain',backupVersion:1,exportedAt:new Date().toISOString(),data:migrateData(data)},blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='student-brain-backup-'+today()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup downloaded')}catch(err){console.error('Backup export failed',err);toast('Could not create backup. Check browser storage and try again.')}}
function restoreData(){const f=document.querySelector('#restore-file')?.files?.[0];if(!f){toast('Choose a JSON backup first');return}if(f.size>20*1024*1024){toast('Backup too large (20 MB maximum)');return}const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result),payload=parsed?.app==='Student Brain'&&parsed?.data?parsed.data:parsed;if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.notes)||!Array.isArray(payload.tasks))throw Error('This file is not a valid Student Brain backup.');for(const key of ['projects','expenses','messages','studySessions','documents'])if(payload[key]!==undefined&&!Array.isArray(payload[key]))throw Error('Backup data looks damaged ('+key+'). No data was changed.');const next=migrateData(payload);if(!confirm('Restore '+(parsed?.exportedAt?'backup from '+new Date(parsed.exportedAt).toLocaleString():'this backup')+' and replace current workspace data? A safety snapshot will be saved first.'))return;localStorage.setItem(KEY+'-pre-restore',JSON.stringify(data));data=next;persist();page='overview';render();toast('Backup restored')}catch(err){console.error('Restore failed',err);toast(err.message||'Invalid backup file')}};reader.onerror=()=>toast('Could not read backup file. Try selecting it again.');reader.readAsText(f)}
function clearData(){if(confirm('Delete all Student Brain data saved in this browser? Export first if you need a backup.')){data=starter();persist();render();toast('Local data cleared')}}
document.addEventListener('click',e=>{const backdrop=e.target.closest('.modal-backdrop');if(backdrop&&e.target===backdrop){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal')){const modalAction=e.target.closest('[data-action]');if(modalAction){e.preventDefault();e.stopPropagation();action(modalAction.dataset.action,modalAction.dataset.id);return}return}const close=e.target.closest('[data-action="close-modal"]');if(close){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal'))return;const pg=e.target.closest('[data-page]');if(pg){page=pg.dataset.page;history.pushState({sbPage:page},'',location.href);render();return}const a=e.target.closest('[data-action]');if(a){action(a.dataset.action,a.dataset.id);return}const q=e.target.closest('[data-question]');if(q){sendChat(q.dataset.question);return}});
document.addEventListener('submit',e=>{if(e.target.id==='edit-form')saveForm(e);if(e.target.id==='chat-form'){e.preventDefault();const i=document.querySelector('#chat-input');sendChat(i.value);}});
document.addEventListener('input',e=>{if(e.target.id==='note-search'){window.noteQuery=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}});
document.addEventListener('change',e=>{if(e.target.id==='document-upload')processUploadedDocuments(e.target.files);if(e.target.id==='quick-add-file-upload'){const selected=Array.from(e.target.files||[]);e.target.value='';processUploadedDocuments(selected)}if(e.target.id==='subject-filter'){window.subjectFilter=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}if(e.target.id==='task-filter'){window.taskFilter=e.target.value;render()}if(e.target.id==='expense-month'){window.expenseMonth=e.target.value;render()}});

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
  const desc=text.replace(/\b(i\s+)?(spent|paid|gave|lent|borrowed|returned|repaid)\b/ig,'').trim()||text;
  if(!confirm('Save money record?\\n\\n'+category+': ₹'+amount.toLocaleString('en-IN')+'\\n'+desc+'\\nDate: '+dateFmt(due||today()))){toast('Not saved');return true}
  data.expenses.push({id:uid(),description:desc,amount:String(amount),category,date:due||today(),kind,updated:Date.now(),created:Date.now()});
  persist();page='expenses';window.expenseMonth=(due||today()).slice(0,7);render();toast('Money record saved');speakVoiceConfirmation('Money record saved.');return true;
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
  speakVoiceConfirmation('Task saved to Planner.');
  return true;
 }
 return false;
};

// Accept speech from the mobile Speak button on every page, not only Ask My Brain.
window.submitStudentBrainVoiceText = function(raw) {
 const phrase=String(raw||'').trim();
 if(!phrase)return false;
 try {
  if(typeof window.handleStudentBrainVoiceCommand==='function'&&window.handleStudentBrainVoiceCommand(phrase))return true;
  if(chatBusy){toast('Brain is still replying. Try speaking again in a moment.');return false;}
  page='ask';
  if(!history.state||history.state.sbPage!=='ask')history.pushState({sbPage:'ask'},'',location.href);
  render();
  sendChat(phrase);
  return true;
 } catch(err) {
  console.error('Voice command failed',err);
  toast('Could not process that voice command. Please try again.');
  return false;
 }
};

const TASK_REMINDER_KEY='student-brain-task-reminders-shown-v1';
function taskReminderDayTime(task){if(!task.due)return null;const [y,m,d]=task.due.split('-').map(Number),[hh,mm]=String(task.reminderTime||'09:00').split(':').map(Number);return new Date(y,m-1,d,hh||0,mm||0,0,0).getTime()}
async function enableTaskReminders(){
 if(!('Notification' in window)){toast('This browser does not support notifications');return}
 try{const permission=await Notification.requestPermission();if(permission==='granted'){toast('Task reminders enabled');checkTaskReminders()}else toast('Notifications blocked. Allow them in browser site settings.')}
 catch(err){toast('Could not enable notifications')}
}
async function checkTaskReminders(){
 if(!('Notification' in window)||Notification.permission!=='granted')return;
 let shown={};try{shown=JSON.parse(localStorage.getItem(TASK_REMINDER_KEY)||'{}')}catch{}
 const now=Date.now();
 for(const task of (data.tasks||[])){
  if(task.done||!task.due||shown[task.id])continue;
  const when=taskReminderDayTime(task);
  if(when!==null&&now>=when&&now<when+24*60*60*1000){
   const title='Student Brain · Task due today';
   const body=task.title+' is due '+(task.reminderTime||'09:00')+' today.';
   try{
    const reg=await navigator.serviceWorker?.ready;
    if(reg?.showNotification)await reg.showNotification(title,{body,icon:'./icons/student-brain.svg',tag:'task-'+task.id,data:{url:'./'}});
    else new Notification(title,{body,tag:'task-'+task.id});
    shown[task.id]=true;localStorage.setItem(TASK_REMINDER_KEY,JSON.stringify(shown));
   }catch(err){console.warn('Task notification failed',err)}
  }
 }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>checkTaskReminders());
else checkTaskReminders();
setInterval(checkTaskReminders,60000);

function speakVoiceConfirmation(message){if(typeof window.isStudentBrainVoiceRepliesOn!=='function'||!window.isStudentBrainVoiceRepliesOn()||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(message);u.lang='en-IN';window.speechSynthesis.speak(u)}


// Keep browser Back inside the app: return to the previous workspace page, not exit the app.
if(!history.state||!history.state.sbPage)history.replaceState({sbPage:'overview'},'',location.href);
window.addEventListener('popstate',e=>{page=e.state?.sbPage||'overview';render();});
render();

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.modal-backdrop'))action('close-modal')});
