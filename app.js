const KEY='student-brain-data-v1';
const DATA_SCHEMA_VERSION=2;
const starter=()=>({schemaVersion:DATA_SCHEMA_VERSION,notes:[],tasks:[],projects:[],expenses:[],messages:[],studySessions:[],documents:[]});
function migrateData(raw){
 const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 const next={...starter(),...source};
 for(const key of ['notes','tasks','projects','expenses','messages','studySessions','documents'])if(!Array.isArray(next[key]))next[key]=[];
 next.schemaVersion=DATA_SCHEMA_VERSION;
 return next;
}
let data=loadData(),page='overview',chatBusy=false;
let cloudClient=null,cloudUser=null,cloudReady=false;
const CLOUD_URL='https://tcthrfpkydcmenxwajfg.supabase.co';
const CLOUD_KEY='sb_publishable_-PlVhv38rbHYFqsfvJ42AQ_S6-2A7JT';
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
function taskRow(t){return `<div class="list-item"><button class="btn small" data-action="toggle-task" data-id="${t.id}" title="Mark complete">${t.done?'✓':'○'}</button><div class="list-copy"><b class="${t.done?'task-done':''}">${esc(t.title)}</b><small>${esc(t.category||'General')} · ${dateFmt(t.due)}</small></div><span class="priority ${esc(t.priority||'Medium')}">${esc(t.priority||'Medium')}</span></div>`}
function noteRow(n){return `<div class="list-item"><div class="list-icon">▤</div><div class="list-copy"><b>${esc(n.title)}</b><small>${esc(n.subject||'General')} · ${new Date(n.updated).toLocaleDateString('en-IN')}</small></div><button class="btn small" data-action="edit-note" data-id="${n.id}">Open</button></div>`}
function projectCard(p){const tasks=data.tasks.filter(t=>t.projectId===p.id),done=tasks.filter(t=>t.done).length;return `<div class="card"><div class="row"><span class="stat-icon">▣</span><span class="tag ${p.status==='Completed'?'green':'blue'}">${esc(p.status||'In progress')}</span></div><h3 style="margin-top:17px">${esc(p.name)}</h3><p class="muted" style="font-size:12px;line-height:1.6;min-height:38px">${esc(p.description||'No description yet.')}</p><div class="row"><small class="muted">${tasks.length} tasks · ${dateFmt(p.targetDate)}</small><button class="btn small" data-action="edit-project" data-id="${p.id}">Edit</button></div>${tasks.length?`<div class="progress"><span style="width:${Math.round(done/tasks.length*100)}%"></span></div>`:''}</div>`}
function scrollChatToBottom(){const chat=document.querySelector('#chat-messages');if(!chat)return;const scroll=()=>{chat.scrollTop=chat.scrollHeight;const last=chat.lastElementChild;if(last)last.scrollIntoView({block:'end',behavior:'auto'});};scroll();requestAnimationFrame(()=>requestAnimationFrame(scroll));}
function render(){try{document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));let c=document.querySelector('#page-content');if(!c)throw Error('Main page container is missing');const pages={overview,ask,knowledge,planner,tasks:planner,study:studyPlanner,backup:backupRestore,projects,expenses,settings};c.innerHTML=(pages[page]||overview)();if(page==='ask')scrollChatToBottom();document.querySelector('.mobile-nav')?.remove();const mob=document.createElement('div');mob.className='mobile-nav';[['overview','▦','Home'],['planner','☑','Tasks'],['study','📚','Study'],['voice','🎙','Voice'],['knowledge','▤','Notes'],['backup','↕','Backup']].forEach(([p,i,l])=>{if(p==='voice'){mob.innerHTML+='<button class="mobile-mic" data-action="voice-quick-command" aria-label="Start voice assistant"><strong>'+i+'</strong><span>Speak</span></button>';return}mob.innerHTML+='<button class="'+(page===p?'active':'')+'" data-page="'+p+'"><strong>'+i+'</strong>'+l+'</button>'});document.body.appendChild(mob)}catch(err){console.error('Student Brain render failed',err);const c=document.querySelector('#page-content');if(c)c.innerHTML='<section class="card"><h2>Workspace could not load</h2><p>Refresh the page. If this continues, export your backup before clearing browser data, then share the browser console error.</p><small></small></section>';const msg=document.querySelector('#page-content small');if(msg)msg.textContent=String(err?.message||err)}}
function overview(){const open=data.tasks.filter(t=>!t.done),due=open.filter(t=>t.due&&t.due>=today()).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,4),recent=[...data.notes].sort((a,b)=>b.updated-a.updated).slice(0,4),month=today().slice(0,7),spend=data.expenses.filter(e=>(e.kind||'expense')==='expense'&&e.date?.startsWith(month)).reduce((s,e)=>s+Number(e.amount||0),0);return `${titleBlock('YOUR PERSONAL WORKSPACE','Good to see you again 👋','Your college life, organized in one place.',`<div class="quick-actions">${btn('+ Quick note','new-note',true)}</div>`)}<div class="hero-card"><div class="eyebrow" style="color:#c8d5ff">YOUR PERSONAL BRAIN</div><h2>Less searching. More learning.</h2><p>Save what matters, keep track of what’s next, and ask questions about your own notes and projects.</p>${btn('Ask your Brain →','go-ask',true)}</div><div class="grid stats">${stat('Knowledge notes',data.notes.length,'Saved in this browser','▤','knowledge')}${stat('Open tasks',open.length,'Assignments & deadlines','◷','planner')}${stat('Active projects',data.projects.filter(p=>p.status!=='Completed').length,'Your workspaces','▣','projects')}${stat('Spent this month',money(spend),'Based on your expense records','₹','expenses')}</div><div class="grid two-col"><div class="card"><div class="row"><h2>Coming up</h2>${btn('View planner','go-planner',false,true)}</div><div class="list">${due.length?due.map(taskRow).join(''):empty('No upcoming tasks. Add an assignment or deadline.','◷')}</div><div style="margin-top:13px">${btn('+ Add task','new-task')}</div></div><div class="card"><div class="row"><h2>Recently saved</h2>${btn('All notes','go-knowledge',false,true)}</div><div class="list">${recent.length?recent.map(noteRow).join(''):empty('Your notes will appear here after you save one.','▤')}</div></div></div>`}
function knowledge(){return `${titleBlock('YOUR KNOWLEDGE','My Knowledge','Save notes, upload exam date sheets and ask questions from your files.',btn('+ New note','new-note',true))}<div class="card document-upload-card"><div><h2>Upload a notice or date sheet</h2><p class="muted">Upload a PDF or image. After extraction, ask about it from the main Ask My Brain page.</p></div><div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary upload-label" for="document-upload">＋ Upload PDF / image</label><button class="btn" data-action="go-ask">Ask My Brain ↗</button></div><input id="document-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" multiple hidden><small id="document-upload-status" class="muted">PDF and image files · max 12 MB each</small></div><div class="grid item-grid document-grid">${(data.documents||[]).length?(data.documents||[]).map(d=>`<article class="card document-card"><div class="row"><span class="tag blue">${d.type==='pdf'?'PDF':'Image'}</span><button class="btn small" data-action="retry-document-ocr" data-id="${d.id}">Retry / recrop OCR</button><button class="btn small danger" data-action="delete-document" data-id="${d.id}">Delete</button></div><h3>${esc(d.name)}</h3><p class="muted">${esc(d.extractedText?.length||0)} characters extracted · ${new Date(d.created).toLocaleDateString('en-IN')}</p><details><summary>View extracted text</summary><p class="document-extract">${esc((d.extractedText||'').slice(0,4500))}${(d.extractedText||'').length>4500?'…':''}</p></details></article>`).join(''):`<div class="card" style="grid-column:1/-1">${empty('Your uploaded notices and date sheets will appear here.','📄')}</div>`}</div><div class="toolbar"><input class="search" id="note-search" placeholder="Search notes, subjects, tags…" value="${esc(window.noteQuery||'')}"><select id="subject-filter" class="search" style="max-width:190px"><option value="">All subjects</option>${[...new Set(data.notes.map(n=>n.subject).filter(Boolean))].map(s=>`<option ${window.subjectFilter===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div id="notes-list" class="grid item-grid">${notesCards()}</div><p class="muted" style="font-size:11px;margin-top:18px">MVP note: notes are saved in your current browser, not synced to an online account.</p>`}
function notesCards(){let q=(window.noteQuery||'').toLowerCase(),s=window.subjectFilter||'';let ns=[...data.notes].filter(n=>(!s||n.subject===s)&&(!q||[n.title,n.content,n.subject,n.tags].join(' ').toLowerCase().includes(q))).sort((a,b)=>b.updated-a.updated);if(!ns.length)return `<div class="card" style="grid-column:1/-1">${empty(q?'No notes match your search.':'No notes yet. Save your first class note or idea.','▤')}${btn('+ Create a note','new-note',true)}</div>`;return ns.map(n=>`<article class="card note-card"><div class="row"><span class="tag blue">${esc(n.subject||'General')}</span><button class="btn small" data-action="edit-note" data-id="${n.id}">Edit</button></div><div class="note-title" style="margin-top:15px">${esc(n.title)}</div><p>${esc(n.content)}</p>${n.attachmentData?`<div class="row" style="margin:8px 0"><small class="muted">📎 ${esc(n.attachmentName||'Attached file')}</small><a class="btn small" href="${n.attachmentData}" download="${esc(n.attachmentName||'attachment')}">Download</a></div>`:''}<div class="row"><small class="muted">${esc(n.tags||'No tags')}</small><button class="btn small danger" data-action="delete-note" data-id="${n.id}">Delete</button></div></article>`).join('')}
function planner(){let filter=window.taskFilter||'Open';let tasks=[...data.tasks].filter(t=>filter==='All'||(filter==='Open'&&!t.done)||(filter==='Completed'&&t.done)||(filter==='Overdue'&&!t.done&&t.due&&t.due<today())).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));return `${titleBlock('STAY ON TRACK','Planner','Assignments, exams and personal deadlines.',btn('+ Add task','new-task',true)+btn('Enable reminders','enable-reminders',false,true))}<div class="toolbar"><select id="task-filter" class="search" style="max-width:220px">${['Open','Overdue','Completed','All'].map(x=>`<option ${filter===x?'selected':''}>${x}</option>`).join('')}</select><span class="muted">${tasks.length} task${tasks.length===1?'':'s'}</span></div><div class="card"><div class="list">${tasks.length?tasks.map(t=>`${taskRow(t)}<div style="text-align:right;margin-top:-8px;padding-bottom:9px"><button class="btn small" data-action="edit-task" data-id="${t.id}">Edit</button> <button class="btn small danger" data-action="delete-task" data-id="${t.id}">Delete</button></div>`).join(''):empty('Nothing here right now. Add a task to get started.','◷')}</div></div>`}
function studyPlanner(){const sessions=[...(data.studySessions||[])].sort((a,b)=>(a.date||'').localeCompare(b.date||''));return `${titleBlock('STUDY ROUTINE','Study planner','Plan study blocks by subject, date and duration.',btn('+ Add study session','new-study',true))}<div class="card"><div class="list">${sessions.length?sessions.map(x=>`<div class="list-item"><div class="list-icon">📚</div><div class="list-copy"><b>${esc(x.subject)}</b><small>${dateFmt(x.date)} · ${esc(x.duration||'')}${x.duration?' min':''} · ${esc(x.topic||'')}</small></div><button class="btn small danger" data-action="delete-study" data-id="${x.id}">Remove</button></div>`).join(''):empty('No study sessions planned yet.','📚')}</div></div>`}
function backupRestore(){return `${titleBlock('YOUR DATA','Backup & restore','Download a backup or restore a previous Student Brain JSON file.') }<div class="grid two-col"><div class="card"><h2>Backup</h2><p class="muted">Export your notes, tasks, study sessions, attachments and workspace data.</p>${btn('Download backup','export-data',true)}</div><div class="card"><h2>Restore</h2><p class="muted">Select a Student Brain backup. Restoring replaces current data.</p><input id="restore-file" type="file" accept=".json,application/json" class="search"><div style="margin-top:12px">${btn('Restore backup','restore-data')}</div></div><div class="card" style="grid-column:1/-1"><h2>Cloud sync</h2><p class="muted">Your workspace is currently stored in this browser. To enable shared, multi-device sync, we need to connect a database and configure secure access rules.</p><span class="tag amber">Cloud connection not configured</span></div></div>`}
function projects(){return `${titleBlock('YOUR WORKSPACES','Projects','Keep project notes, tasks and milestones connected.',btn('+ New project','new-project',true))}<div class="grid item-grid">${data.projects.length?[...data.projects].sort((a,b)=>b.updated-a.updated).map(projectCard).join(''):`<div class="card" style="grid-column:1/-1">${empty('No projects yet. Create one for your semester project, hackathon or personal idea.','▣')}${btn('+ Create project','new-project',true)}</div>`}</div>`}
function expenseStat(label,num,note,icon,kind){return '<button type="button" class="card stat-card expense-quick-action" data-action="expense-quick-action" data-id="'+kind+'" title="'+(kind==='all'?'View all records':'Quick add')+'"><span class="row"><span class="stat-label">'+label+'</span><span class="stat-icon">'+icon+'</span></span><span class="stat-number">'+num+'</span><span class="stat-note">'+note+'<span class="stat-open-hint"> · '+(kind==='all'?'View all →':'Quick add +')+'</span></span></button>'}\nfunction expenses(){const month=window.expenseMonth||today().slice(0,7),es=[...data.expenses].filter(e=>!month||e.date?.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date)),kind=e=>e.kind||'expense',sum=k=>es.filter(e=>kind(e)===k).reduce((n,e)=>n+Number(e.amount||0),0),spent=sum('expense'),lent=sum('lent')-sum('lent_repayment'),borrowed=sum('borrowed')-sum('borrowed_repayment'),moneyRows=es.filter(e=>kind(e)!=='expense');return `${titleBlock('STUDENT BUDGET','Money & Udhaar','Track daily spending, money lent or borrowed, and repayments.',btn('+ Add transaction','new-expense',true))}<div class="grid stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">${expenseStat('Spending this month',money(spent),month||'All records','₹','expense')}${expenseStat('You are owed',money(lent),'Lent less received repayments','↗','lent')}${expenseStat('You owe others',money(borrowed),'Borrowed less repayments','↙','borrowed')}${expenseStat('Records',es.length,'Expenses + udhaar entries','₹','all')}</div><div class="toolbar"><input id="expense-month" type="month" class="search" style="max-width:210px" value="${esc(month)}">${btn('Show all','all-expenses')}</div><div class="card"><div class="list">${es.length?es.map(e=>`<div class="list-item"><div class="list-icon">₹</div><div class="list-copy"><b>${esc(e.description)}</b><small>${esc(({expense:'Expense',lent:'Lent',borrowed:'Borrowed',lent_repayment:'Received repayment',borrowed_repayment:'Repaid'}[kind(e)]||'Transaction'))}${e.person?' · '+esc(e.person):''} · ${esc(e.category||'Other')} · ${dateFmt(e.date)}</small></div><b>${money(e.amount)}</b><button class="btn small" data-action="edit-expense" data-id="${e.id}">Edit</button><button class="btn small danger" data-action="delete-expense" data-id="${e.id}">×</button></div>`).join(''):empty('No transactions for this month. Add your first record.','₹')}</div></div>`}
function ask(){return `<div class="chat-shell"><div class="chat-intro"><div class="brain-icon">✧</div><div class="eyebrow">YOUR PERSONAL AI</div><h2>Ask your Brain</h2><p>Ask about your notes, uploaded PDFs/images, tasks, or your money and udhaar ledger.</p><span class="tag amber">Keyword search across your saved knowledge</span><div class="suggestions"><button class="suggestion" data-question="Summarize my notes">Summarize my notes</button><button class="suggestion" data-question="What subjects have I saved?">What subjects have I saved?</button><button class="suggestion" data-question="What should I work on next?">What should I work on next?</button><button class="suggestion" data-question="Who owes me money?">Who owes me money?</button><button class="suggestion" data-question="How much do I owe others?">How much do I owe others?</button></div></div><div class="chat-messages" id="chat-messages">${data.messages.map(m=>`<div class="bubble ${m.role==='user'?'user':'assistant'}">${formatChatText(m.content)}${m.sources?.length?`<span class="source">Sources: ${m.sources.map(esc).join(', ')}</span>`:''}</div>`).join('')||`<div class="bubble assistant">Hi! Ask me about your saved notes or uploaded PDF/image files. I’ll find matching keywords and show the source.</div>`}</div><form class="chat-form" id="chat-form"><input id="chat-input" placeholder="Ask about notes or uploaded files…" autocomplete="off"><button class="btn primary" type="submit" ${chatBusy?'disabled':''}>Send ↗</button></form><div class="chat-note">Searches extracted file text and saved notes locally using keywords. This is retrieval, not a generative AI answer.</div></div>`}
function settings(){return `${titleBlock('PREFERENCES','Settings','Manage your workspace and data safety.')}<div class="grid two-col"><div class="card"><h2>Workspace</h2><div class="list-item"><div class="list-icon">✦</div><div class="list-copy"><b>Student Brain</b><small>Personal student workspace</small></div><span class="tag green">Ready</span></div><p class="muted" style="font-size:12px;line-height:1.7;margin-top:15px">Your data is stored in this browser. Export regular backups to keep a copy.</p></div><div class="card"><h2>Data controls</h2><p class="muted" style="font-size:12px;line-height:1.7">Download a backup before clearing local data.</p><div class="actions">${btn('Export my data ↓','export-data',true)}${btn('Clear all data','clear-data')}</div></div></div>`}function modal(title,body,saveLabel='Save'){document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>${title}</h2><button type="button" class="xbtn" data-action="close-modal" aria-label="Close dialog">×</button></div><form id="edit-form">${body}<div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button class="btn primary" type="submit">${saveLabel}</button></div></form></div></div>`}
function field(label,name,value='',type='text',opts={}){let val=esc(value??'');if(type==='textarea')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><textarea name="${name}" ${opts.required?'required':''} placeholder="${esc(opts.placeholder||'')}">${val}</textarea></div>`;if(type==='select')return `<div class="field ${opts.full?'full':''}"><label>${label}</label><select name="${name}">${opts.options.map(o=>{const parts=String(o).split('|'),v=parts.length>1?parts.shift():String(o),text=parts.length?parts.join('|'):String(o);return `<option value="${esc(v)}" ${v===String(value??'')?'selected':''}>${esc(text)}</option>`}).join('')}</select></div>`;return `<div class="field ${opts.full?'full':''}"><label>${label}</label><input name="${name}" type="${type}" value="${val}" ${opts.required?'required':''} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.accept?`accept="${esc(opts.accept)}"`:''} placeholder="${esc(opts.placeholder||'')}"></div>`}
let editing=null,formType='';
function openForm(type,id){editing=id||null;formType=type;let obj=id?data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'].find(x=>x.id===id)||{}:{};let body='';
if(type==='note')body=(id?'':field('Attach PDF / image (up to 12 MB)','attachment','', 'file',{full:true,accept:'.pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff'}))+field('Title','title',obj.title,'text',{full:true})+field('Subject','subject',obj.subject,'text',{placeholder:'e.g. Data Structures'})+field('Tags','tags',obj.tags,'text',{placeholder:'e.g. exam, unit 2'})+field('Content','content',obj.content,'textarea',{full:true,placeholder:'Write or paste your notes here… (optional if attaching a file)'});
if(type==='task')body=field('Task title','title',obj.title,'text',{required:true,full:true})+field('Subject / category','category',obj.category||'Assignment')+field('Due date','due',obj.due,'date')+field('Reminder time','reminderTime',obj.reminderTime||'09:00','time')+field('Priority','priority',obj.priority||'Medium','select',{options:['Low','Medium','High']})+field('Related project','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)].map(x=>x.includes('|')?x:x),full:true})+field('Notes','notes',obj.notes,'textarea',{full:true});
if(type==='study')body=field('Subject','subject','','text',{required:true,full:true})+field('Topic / chapter','topic','','text',{full:true})+field('Date','date',today(),'date',{required:true})+field('Duration (minutes)','duration','45','number',{required:true,min:1});
if(type==='project')body=field('Project name','name',obj.name,'text',{required:true,full:true})+field('Description','description',obj.description,'textarea',{full:true})+field('Status','status',obj.status||'In progress','select',{options:['In progress','On hold','Completed']})+field('Target date','targetDate',obj.targetDate,'date');
if(type==='expense')body=field('Transaction type','kind',obj.kind||'expense','select',{options:['expense|Expense / spending','lent|I lent money','borrowed|I borrowed money','lent_repayment|Money returned to me','borrowed_repayment|I repaid money']})+field('Description','description',obj.description,'text',{required:true,full:true})+field('Person','person',obj.person||'','text',{full:true,placeholder:'Name of person (optional for expense)'})+field('Amount (₹)','amount',obj.amount,'number',{required:true,min:0})+field('Category','category',obj.category||'Food','select',{options:['Food','Travel','Books & supplies','College fees','Entertainment','Shopping','Other','Udhaar','Repayment']})+field('Date','date',obj.date||today(),'date',{required:true})+field('Related project (optional)','projectId',obj.projectId||'','select',{options:['',...data.projects.map(p=>p.id+'|'+p.name)] .map(x=>x.includes('|')?x:x),full:true});
const arr=data[type==='note'?'notes':type==='task'?'tasks':type==='project'?'projects':'expenses'];const old=obj.projectId||'';body=body.replaceAll('value="'+esc(old)+'"','value="'+esc(old)+'"');
modal((id?'Edit ':'New ')+({note:'note',task:'task',study:'study session',project:'project',expense:'expense'}[type]),body,id?'Save changes':'Create');const firstField=document.querySelector('#edit-form input:not([type=file]),#edit-form textarea,#edit-form select');if(firstField){firstField.removeAttribute('readonly');firstField.removeAttribute('disabled');firstField.focus();}}
async function saveForm(e){e.preventDefault();const fd=new FormData(e.target),v=Object.fromEntries(fd.entries()),key=formType==='note'?'notes':formType==='task'?'tasks':formType==='project'?'projects':'expenses';if(formType==='note'){delete v.attachment;const file=e.target.querySelector('input[name=attachment]')?.files?.[0];if(!String(v.title||'').trim()&&file)v.title=file.name;if(!file&&!String(v.content||'').trim()){toast('Attach a PDF/image or enter note content');return}if(!String(v.title||'').trim()){toast('Please enter a title');return}if(file){e.target._quickUploadFile=file;if(file.size>12*1024*1024){toast('File limit is 12 MB');return}if(!(file.type==='application/pdf'||file.type.startsWith('image/'))){toast('Please choose a PDF or image');return}try{v.attachmentName=file.name;v.attachmentType=file.type||'application/octet-stream';v.attachmentData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)})}catch(_){toast('Could not read this file');return}}}if(['task','expense'].includes(formType)&&v.projectId?.includes('|'))v.projectId=v.projectId.split('|')[0];if(!v.projectId)delete v.projectId;if(formType==='study'){data.studySessions=data.studySessions||[];data.studySessions.push({id:uid(),...v,created:Date.now()});persist();document.querySelector('#modal-root').innerHTML='';render();toast('Study session planned');return}if(formType==='expense'&&(!Number.isFinite(Number(v.amount))||Number(v.amount)<=0)){toast('Enter a valid amount');return}if(formType==='expense'){v.kind=v.kind||'expense';if(v.kind!=='expense'&&!String(v.person||'').trim()){toast('Enter the person name for lending or repayment');return}}let obj=editing?data[key].find(x=>x.id===editing):null;if(obj)Object.assign(obj,v,{updated:Date.now()});else data[key].push({id:uid(),...v,done:false,updated:Date.now(),created:Date.now()});persist();document.querySelector('#modal-root').innerHTML='';render();toast(editing?'Changes saved':'Created successfully');if(formType==='note'&&e.target._quickUploadFile){const savedNote=data.notes.find(n=>n.id===editing)||data.notes[data.notes.length-1];await processUploadedDocuments([e.target._quickUploadFile],savedNote?.id||null);e.target._quickUploadFile=null}}
async function retryDocumentOCR(id){
 const doc=(data.documents||[]).find(d=>d.id===id);if(!doc)return;
 const picker=document.createElement('input');picker.type='file';picker.accept=doc.type==='pdf'?'.pdf':'image/*';
 picker.onchange=async()=>{const file=picker.files?.[0];if(!file)return;if(file.size>12*1024*1024){toast('File is over 12 MB');return}
 try{
  let text='';
  if(doc.type==='pdf'){
   if(!window.pdfjsLib)throw Error('PDF reader unavailable. Refresh and retry.');
   window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
   const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
   if(pdf.numPages>100)throw Error('PDF exceeds 100 pages.');
   for(let p=1;p<=pdf.numPages;p++){const pg=await pdf.getPage(p),ct=await pg.getTextContent();text+='\\n[Page '+p+']\\n'+ct.items.map(x=>x.str).join(' ')}
  }else{
   if(!window.Tesseract)throw Error('OCR engine unavailable. Refresh and retry.');
   text=await runImageOCR(file);
  }
  if(!text.trim())throw Error('No text detected. Try a sharper image or crop to the text area.');
  doc.extractedText=text.trim();doc.name=file.name;doc.created=Date.now();persist();render();toast('Document text refreshed');
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
 const status=document.querySelector('#document-upload-status');
 const setStatus=(message)=>{if(status)status.textContent=message;const live=document.querySelector('#ocr-live-status');if(live)live.textContent=message};
 for(const file of list){
  if(!file || file.size===0){setStatus((file?.name||'Selected file')+' is empty. Choose a file containing data.');toast('Empty file cannot be processed');continue}
  if(file.size>12*1024*1024){setStatus(file.name+' exceeds 12 MB. Choose a smaller file.');toast('File is over 12 MB');continue}
  if(!file.type.startsWith('image/')&&file.type!=='application/pdf'&&!/\\.pdf$/i.test(file.name)&&!/\\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(file.name)){setStatus('Unsupported file type. Upload a PDF or image.');toast('Unsupported file type');continue}
  setStatus('Reading '+file.name+'…');
  try{
   let extracted='';const isPdf=file.type==='application/pdf'||/\\.pdf$/i.test(file.name);
   if(isPdf){
    if(!window.pdfjsLib)throw Error('PDF text reader is unavailable. Check your connection and refresh.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    if(pdf.numPages>100)throw Error('This PDF has more than 100 pages. Split it into smaller files.');
    for(let p=1;p<=pdf.numPages;p++){setStatus('Extracting page '+p+' of '+pdf.numPages+' · '+file.name);const page=await pdf.getPage(p),content=await page.getTextContent();extracted+='\\n[Page '+p+']\\n'+content.items.filter(i=>String(i.str||'').trim()).map(i=>({text:i.str,x:i.transform?.[4]||0,y:i.transform?.[5]||0})).sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x).reduce((rows,it)=>{let row=rows.find(r=>Math.abs(r.y-it.y)<=3);if(!row){row={y:it.y,items:[]};rows.push(row)}row.items.push(it);return rows},[]).sort((a,b)=>b.y-a.y).map(row=>row.items.sort((a,b)=>a.x-b.x).map(it=>it.text).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean).join('\\n')}
   }else{
    if(!window.Tesseract)throw Error('Image OCR is unavailable. Check your connection and refresh.');
    setStatus('Reading image text · '+file.name);
    let result;
    try{result=await window.Tesseract.recognize(file,'eng+hin')}catch(_){result=await window.Tesseract.recognize(file,'eng')}
    extracted=result.data.text||'';
   }
   if(!extracted.trim())throw Error('No text detected. Try a clearer image or a text-based PDF.');
   data.documents=data.documents||[];
   const extractedText=extracted.trim();data.documents.push({id:uid(),name:file.name,type:isPdf?'pdf':'image',extractedText,chunks:splitDocumentIntoChunks(extractedText),created:Date.now(),sourceNoteId:sourceNoteId||null,sourceKind:sourceNoteId?'note-attachment':'uploaded-file'});
   persist();render();setStatus('Text extracted from '+file.name);toast('Text extracted');
  }catch(err){console.error('Document extraction failed',err);setStatus('Could not read '+file.name+': '+(err.message||'unknown error'));toast('Extraction failed. See upload status.')}
 }
}
function askDocument(id){
 const doc=(data.documents||[]).find(d=>d.id===id);if(!doc)return;
 const q=prompt('Ask a question about '+doc.name);if(!q||!q.trim())return;
 const stop=new Set(['what','when','where','which','does','this','that','from','with','tell','show','about','please','date','sheet','the','and','for','are','was','is','in','on','of']);
 const terms=q.toLowerCase().replace(/[^\\w\\s]/g,' ').split(/\\s+/).filter(w=>w.length>2&&!stop.has(w));
 const lines=(doc.extractedText||'').split(/\\n+/).filter(s=>s.trim());
 const chunks=[];for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(/^\\[Page \\d+\\]$/.test(line))continue;chunks.push(line)}
 const ranked=chunks.map((text,index)=>{const normalized=text.toLowerCase();const score=terms.reduce((n,t)=>n+(normalized.includes(t)?1:0),0);return {text,index,score}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,5);
 const answer=ranked.length?ranked.map(x=>x.text).join('\\n\\n'):'No matching passage was found. Try the exact course name, subject code, date, or a phrase printed in the file.';
 modal('Answer from '+esc(doc.name),'<div class="document-answer"><p><b>Your question</b></p><p>'+esc(q)+'</p><p><b>Relevant text from the uploaded file</b></p><div class="answer-extract">'+esc(answer)+'</div><small class="muted">Source: '+esc(doc.name)+(ranked.length?' · Text extracted from this file':' · No matching passage')+'</small><p class="muted">This searches extracted text locally; it does not generate an AI answer. Confirm important dates against the original document.</p></div>','Close');
 document.querySelector('#modal-root .modal-actions .primary')?.setAttribute('type','button');
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
function aiAnswer(q){
 const raw=String(q||'').trim();
 // Answer direct questions about projects from the saved project records.
 if(/\b(my|our|mera|hamara|humara|created|saved|made|banaya|banaye|project name|project title|project ka naam|project names|projects)\b/i.test(raw)&&/\b(name|naam|title|which|what|kaunsa|kaun|kya|tell|bata|show|list)\b/i.test(raw)){
  const projects=(data.projects||[]).filter(p=>String(p.name||p.title||'').trim());
  if(projects.length){
   const lines=projects.map((p,i)=>(i+1)+'. '+String(p.name||p.title).trim()+(p.status?' — '+p.status:'')+(p.targetDate?' · target '+p.targetDate:''));
   return {answer:projects.length===1?'Your saved project name is: '+String(projects[0].name||projects[0].title).trim()+'.':'Your saved project names are:\\n'+lines.join('\\n'),sources:['Saved projects']};
  }
  return {answer:'I could not find a saved project name in your Projects section yet. Open Projects and check whether the project was saved successfully.',sources:['Saved projects']};
 }
 // Money ledger questions are answered separately from ordinary spending.
 const loanIntent=/\b(udhaar|lent|lending|borrow|borrowed|loan|repay|repaid|repayment|outstanding|owe|owed|who owes|whom do i owe|wapas|mujhe dena|maine liya)\b/i.test(raw);
 if(loanIntent){
  const ledger=(data.expenses||[]).filter(e=>['lent','borrowed','lent_repayment','borrowed_repayment'].includes(e.kind)&&Number.isFinite(Number(e.amount)));
  const fmt=n=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
  const nameMatch=raw.match(/\b(?:to|from|with|ko|se)\\s+([a-z][a-z'-]{1,30})/i);
  const name=nameMatch?.[1]?.toLowerCase();
  const rows=name?ledger.filter(e=>String(e.person||'').toLowerCase().includes(name)):ledger;
  const sum=(kind)=>rows.filter(e=>e.kind===kind).reduce((n,e)=>n+Number(e.amount||0),0);
  const lent=sum('lent'),gotBack=sum('lent_repayment'),borrowed=sum('borrowed'),paid=sum('borrowed_repayment');
  if(/who|whom|people|person|kisko|kis se|list/i.test(raw)){
   const by={};ledger.forEach(e=>{const p=String(e.person||'Unnamed').trim();by[p]??={toMe:0,fromMe:0};if(e.kind==='lent')by[p].toMe+=Number(e.amount||0);if(e.kind==='lent_repayment')by[p].toMe-=Number(e.amount||0);if(e.kind==='borrowed')by[p].fromMe+=Number(e.amount||0);if(e.kind==='borrowed_repayment')by[p].fromMe-=Number(e.amount||0)});
   const lines=Object.entries(by).filter(([,v])=>v.toMe>0||v.fromMe>0).map(([p,v])=>p+': owes you '+fmt(Math.max(0,v.toMe))+'; you owe '+fmt(Math.max(0,v.fromMe)));
   return {answer:lines.length?'Person-wise outstanding balances:\\n'+lines.join('\\n'):'No outstanding money balances recorded.',sources:['Money ledger']};
  }
  if(/borrow|borrowed|owe|mujhe dena|maine liya/i.test(raw)&&!/lent|lending|mujhe lena|owed to me/i.test(raw))return {answer:(name?name+' — ':'')+'Borrowed '+fmt(borrowed)+', repaid '+fmt(paid)+', still owed '+fmt(borrowed-paid)+'.',sources:['Money ledger']};
  if(/lent|lending|mujhe lena|owed to me|udhaar diya/i.test(raw))return {answer:(name?name+' — ':'')+'Lent '+fmt(lent)+', received back '+fmt(gotBack)+', still owed to you '+fmt(lent-gotBack)+'.',sources:['Money ledger']};
  return {answer:'Outstanding: people owe you '+fmt(ledger.filter(e=>e.kind==='lent').reduce((n,e)=>n+Number(e.amount||0),0)-ledger.filter(e=>e.kind==='lent_repayment').reduce((n,e)=>n+Number(e.amount||0),0))+'. You owe others '+fmt(ledger.filter(e=>e.kind==='borrowed').reduce((n,e)=>n+Number(e.amount||0),0)-ledger.filter(e=>e.kind==='borrowed_repayment').reduce((n,e)=>n+Number(e.amount||0),0))+'.',sources:['Money ledger']};
 }
 // Expense questions should be answered from saved expense data before knowledge retrieval.
 const expenseIntent=/\b(spend|spent|spending|expense|expenses|money|kharch|kharcha|transaction|transactions|budget|cost)\b/i.test(raw);
 if(expenseIntent){
  const all=(data.expenses||[]).filter(e=>e.date&&Number.isFinite(Number(e.amount))&&(e.kind||'expense')==='expense');
  const now=today(),month=now.slice(0,7);
  let label='this month',start=month+'-01',end=now;
  if(/\b(last month|previous month|pichhle mahine)\b/i.test(raw)){
   const d=new Date(now+'T12:00:00');d.setDate(1);d.setMonth(d.getMonth()-1);
   start=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01';
   const last=new Date(d.getFullYear(),d.getMonth()+1,0);
   end=last.getFullYear()+'-'+String(last.getMonth()+1).padStart(2,'0')+'-'+String(last.getDate()).padStart(2,'0');label='last month';
  }else if(/\b(today|aaj)\b/i.test(raw)){start=end=now;label='today'}
  else if(/\b(all time|overall|total ever|all records)\b/i.test(raw)){start='0000-01-01';end='9999-12-31';label='all recorded time'}
  const rows=all.filter(e=>e.date>=start&&e.date<=end);
  const total=rows.reduce((sum,e)=>sum+Number(e.amount||0),0);
  const fmt=n=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
  if(/\b(category|categories|where|breakdown|kis cheez|kis par)\b/i.test(raw)){
   const by={};rows.forEach(e=>{const k=e.category||'Other';by[k]=(by[k]||0)+Number(e.amount||0)});
   const detail=Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+': '+fmt(v));
   return {answer:rows.length?'Your spending breakdown for '+label+':\n'+detail.join('\n')+'\n\nTotal: '+fmt(total)+' ('+rows.length+' records).':'No expense records found for '+label+'. Add expenses in the Expenses section first.',sources:['Expenses']};
  }
  if(/\b(list|show|transactions|records|details)\b/i.test(raw)){
   const lines=rows.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map(e=>dateFmt(e.date)+' · '+(e.description||e.category||'Expense')+' · '+fmt(e.amount));
   return {answer:rows.length?'Expense records for '+label+':\n'+lines.join('\n')+'\n'+(rows.length>12?'…and '+(rows.length-12)+' more.\n':'')+'Total: '+fmt(total):'No expense records found for '+label+'. Add expenses in the Expenses section first.',sources:['Expenses']};
  }
  return {answer:rows.length?'You spent '+fmt(total)+' '+label+' across '+rows.length+' expense record'+(rows.length===1?'':'s')+'.\\nDates: '+[...new Set(rows.map(e=>dateFmt(e.date)))].sort().join(', '):'No expense records found for '+label+'. Add expenses in the Expenses section first.',sources:['Expenses']};
 }
 const normalize=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[’']/g,'').replace(/\bmid[\s-]*term[\s-]*i{1,3}\b/g,(m)=>'midterm '+(m.match(/i{1,3}$/)?.[0].length||1)).replace(/\bmid[\s-]*term\b/g,'midterm').replace(/\b(m[\s-]*t)[\s-]*(\d+)\b/g,'midterm $2').replace(/\b(first|1st|one)\b/g,'1').replace(/\b(second|2nd|two)\b/g,'2').replace(/\b(third|3rd|three)\b/g,'3').replace(/\b(fourth|4th|four)\b/g,'4').replace(/\b(exam|examination|paper|test)\b/g,'exam').replace(/\b(kab|when|date|on which date|kis din|ki date)\b/g,'date').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
 const stop=new Set(['what','when','where','which','does','this','that','from','with','tell','show','about','please','the','and','for','are','was','is','in','on','of','your','have','could','should','would','can','find','search','me','my','brain','ask','file','uploaded','document','date','exam','paper','test','kab','hai','h','ki','ka','ke','kya','bata','do','or','to','a','an','as','at','by','it','be','schedule','time','timing']);
 const qnorm=normalize(raw);let terms=[...new Set(qnorm.split(/\s+/).filter(w=>w.length>1&&!stop.has(w)))];
 // Search task titles, categories and notes when the question relates to saved work.
 const taskCorpus=(data.tasks||[]).filter(t=>!t.done).map(t=>({task:t,text:[t.title,t.category,t.notes].filter(Boolean).join(' ')}));
 const taskQuery=/\b(task|tasks|todo|to do|pending|unfinished|incomplete|overdue|deadline|remind|reminder|work on next|what should i do|what do i have to do)\b/i.test(raw);
 const matchedTasks=taskCorpus.map(x=>({...x,score:terms.reduce((n,w)=>n+(normalize(x.text).split(' ').includes(w)?2:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 if(taskQuery||matchedTasks.length){
  const openTasks=(data.tasks||[]).filter(t=>!t.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  const overdue=openTasks.filter(t=>t.due&&t.due<today()),dueToday=openTasks.filter(t=>t.due===today());
  const allDone=(data.tasks||[]).filter(t=>t.done);
  if(/\b(completed|finished|done)\b/i.test(raw)&&!/\bnot done|pending\b/i.test(raw))
   return {answer:allDone.length?'Completed tasks:\\n'+allDone.slice(-8).map(t=>'✓ '+t.title+(t.due?' — '+t.due:'')).join('\\n'):'You have no completed tasks yet.',sources:['Tasks']};
  if(!openTasks.length)return {answer:'You have no pending tasks right now. Add a task in Tasks & Reminders first.',sources:['Tasks & Reminders']};
  let selected=matchedTasks.length?matchedTasks.map(x=>x.task):openTasks;
  if(/\boverdue\b/i.test(raw))selected=overdue;
  else if(/\btoday\b|\bdue today\b/i.test(raw))selected=dueToday;
  else if(/\bnext|priority|important|urgent|what should i do\b/i.test(raw))selected=[...overdue,...openTasks.filter(t=>!overdue.includes(t))].slice(0,6);
  if(!selected.length)return {answer:'I could not find a pending task matching that query. Try searching with a word from the task title.',sources:['Tasks & Reminders']};
  const lines=selected.slice(0,8).map(t=>'• '+t.title+' — '+(t.due?(t.due<today()?'OVERDUE · ':t.due===today()?'Due today · ':'Due ')+t.due:'No due date')+' · Priority: '+(t.priority||'Medium')+(t.category?' · '+t.category:'')+(t.notes?'\\n  Details: '+t.notes:''));
  return {answer:'I found these matching pending tasks:\\n'+lines.join('\\n'),sources:['Tasks & Reminders']};
 }
 // Task-aware answers: include the user's live task list in Ask My Brain retrieval.
 const taskIntent=/\b(task|tasks|todo|to do|pending|unfinished|incomplete|overdue|deadline|remind|reminder|work on next|what should i do|what do i have to do)\b/i.test(raw);
 if(taskIntent){
  const openTasks=(data.tasks||[]).filter(t=>!t.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  const overdue=openTasks.filter(t=>t.due&&t.due<today()),dueToday=openTasks.filter(t=>t.due===today()),upcoming=openTasks.filter(t=>t.due>today());
  const allDone=(data.tasks||[]).filter(t=>t.done);
  if(/\b(completed|finished|done)\b/i.test(raw)&&!/\bnot done|pending\b/i.test(raw)){
   return {answer:allDone.length?'Completed tasks:\n'+allDone.slice(-8).map(t=>'✓ '+t.title+(t.due?' — '+t.due:'')).join('\n'):'You have no completed tasks yet.',sources:['Tasks']};
  }
  if(!openTasks.length)return {answer:'You have no pending tasks right now. You can add a task in Tasks & Reminders.',sources:['Tasks']};
  let selected=/\boverdue\b/i.test(raw)?overdue:/\btoday\b|\bdue today\b/i.test(raw)?dueToday:openTasks;
  if(/\bnext|priority|important|urgent|what should i do\b/i.test(raw))selected=[...overdue,...dueToday,...upcoming].slice(0,6);
  if(!selected.length)return {answer:'No tasks match that time filter. Your pending tasks are clear for that period.',sources:['Tasks']};
  const lines=selected.slice(0,10).map(t=>'• '+t.title+' — '+(t.due?(t.due<today()?'OVERDUE · ':t.due===today()?'Due today · ':'Due ')+t.due:'No due date')+' · Priority: '+(t.priority||'Medium')+(t.category?' · '+t.category:'')+(t.notes?'\n  Details: '+t.notes:''));
  return {answer:(overdue.length?'You have '+overdue.length+' overdue task(s).\n\n':'')+'Here are your pending tasks:\n'+lines.join('\n'),sources:['Tasks & Reminders']};
 }

 if(!terms.length)return {answer:'Please include a topic, course, or exam name so I can search your saved knowledge.',sources:[]}; const candidates=[],add=(text,source,kind,meta={})=>{const clean=String(text||'').trim();if(clean)candidates.push({text:clean,source,kind,...meta})};
 // Directly answer timetable queries by extracting the matching schedule rows and returning all requested courses.
 const timetableQuestion=/mid\s*term|midterm|timetable|time\s*table/i.test(raw);
 if(timetableQuestion){
  const allRows=[];
  (data.documents||[]).filter(d=>d.extractedText).forEach(doc=>{
   const records=extractTimetableData(doc.extractedText);
   if(records.length)allRows.push({doc,records});
  });
  const requested=['AEC','VAC','SEC','OPEN ELECTIVE'].filter(course=>new RegExp('\b'+course.replace(' ','\\s+')+'\b','i').test(raw));
  const allRecords=allRows.flatMap(({doc,records})=>records.map(r=>({doc,r})));
  const dates=[...new Set(allRecords.map(x=>x.r.date))].sort((a,b)=>{const p=s=>{const [d,m,y]=s.split('.').map(Number);return new Date(y,m-1,d).getTime()};return p(a)-p(b)});
  const normalized=raw.toLowerCase().replace(/[^a-z0-9]+/g,' ');
  const ordinal=/(mid\s*term|midterm)\s*(2|ii|second|2nd)\b/.test(normalized)?2:/(mid\s*term|midterm)\s*(1|i|first|1st)\b/.test(normalized)?1:null;
  const targetDate=ordinal?dates[ordinal-1]:null;
  const selected=allRecords.filter(({r})=>(!requested.length||requested.includes(r.course))&&(!targetDate||r.date===targetDate));
  if(selected.length){
   const uniqueRows=[...new Map(selected.map(x=>[x.r.course+'|'+x.r.date+'|'+x.r.start,x])).values()];
   const lines=uniqueRows.map(({r})=>r.course+' — '+r.date+(r.day?' ('+r.day+')':'')+' · '+r.start+'–'+r.end);
   const src=[...new Set(uniqueRows.map(x=>x.doc.name))].map(name=>'Attachment: '+name);
   const label=ordinal?'Mid Term-'+ordinal:'Timetable';
   return {answer:label+' schedule:\\n'+lines.join('\\n'),sources:src};
  }
 }

 (data.documents||[]).filter(d=>d.extractedText).forEach(doc=>{
  const note=(data.notes||[]).find(n=>n.id===doc.sourceNoteId),source=note?{label:note.title||'Attached note',file:doc.name,noteId:note.id,documentId:doc.id}:{label:doc.name,file:doc.name,documentId:doc.id};
  let page=null;const lines=String(doc.extractedText).split(/\n+/).map(s=>s.trim()).filter(Boolean).map(line=>{const marker=line.match(/^\[Page\s+(\d+)\]$/i);if(marker){page=Number(marker[1]);return null}return {text:line,page}}).filter(Boolean);
  lines.forEach((line,i)=>add([lines[i-1]?.page===line.page?lines[i-1].text:null,line.text,lines[i+1]?.page===line.page?lines[i+1].text:null].filter(Boolean).join(' '),source,'document',{index:i,page:line.page}));
 });
 (data.notes||[]).forEach(n=>add([n.title,n.subject,n.tags,n.content].filter(Boolean).join(' '),{label:n.title||'Saved note',noteId:n.id},'note'));
 // Index every saved workspace section for Ask Brain retrieval, not just notes and OCR documents.
 (data.projects||[]).forEach(p=>add([p.name,p.title,p.description,p.status,p.category,p.notes,p.goals,p.milestones].filter(Boolean).join(' '),{label:'Project: '+(p.name||p.title||'Untitled'),projectId:p.id},'project'));
 (data.tasks||[]).forEach(t=>add([t.title,t.category,t.notes,t.priority,t.due,t.projectId,t.done?'completed':'pending'].filter(Boolean).join(' '),{label:'Task: '+(t.title||'Untitled'),taskId:t.id},'task'));
 (data.studySessions||[]).forEach(x=>add(Object.entries(x||{}).filter(([k,v])=>!['id','created','updated'].includes(k)&&v!==null&&v!==undefined).map(([k,v])=>k+': '+(typeof v==='object'?JSON.stringify(v):v)).join(' '),{label:'Study session',sessionId:x.id},'study'));
 (data.expenses||[]).forEach(e=>add([e.description,e.category,e.person,e.kind,e.amount,e.date,e.projectId].filter(Boolean).join(' '),{label:'Money record: '+(e.description||e.category||'Transaction'),expenseId:e.id},'expense'));
 (data.messages||[]).forEach(m=>{const textValue=[m.question,m.prompt,m.answer,m.content,m.text].filter(Boolean).join(' ');if(textValue)add(textValue,{label:(m.role==='user'?'Your question':'Brain answer')+(m.content?' · '+String(m.content).slice(0,70):''),messageId:m.id},'message')});
 const tokens=s=>normalize(s).split(/\s+/).filter(Boolean);
 // Queries like "mid term 1" should match the heading "Mid Term-I" even if OCR drops punctuation or Roman numerals.
 const queryMidterm=/\bmidterm\s*1\b/.test(qnorm),queryCourse=terms.some(t=>['aec','vac','sec'].includes(t));
 const score=cand=>{
  const docTokens=tokens(cand.text),docSet=new Set(docTokens);
  const matched=terms.filter(t=>docSet.has(t));
  const partial=terms.filter(t=>!docSet.has(t)&&docTokens.some(w=>w.length>=3&&t.length>=3&&(w.includes(t)||t.includes(w))));
  let s=matched.length*2.5+partial.length*.8+(matched.length/terms.length)*3;
  if(terms.length>1&&matched.length===terms.length)s+=2;
  if(queryMidterm&&/\bmid\s*term\b|\bmidterm\b/i.test(cand.text)&&(/\btheory\b|\b31[./-]10[./-]2026\b|\b2026\b/i.test(cand.text)))s+=5;
  if(queryCourse&&terms.some(t=>docSet.has(t)))s+=2;
  if(/\b(date|when|kab|schedule|deadline|due)\b/i.test(qnorm)&&/\b\d{1,2}[.\s/-]+\d{1,2}[.\s/-]+\d{2,4}\b/.test(cand.text))s+=1.5;
  return s;
 };
 const ranked=candidates.map(x=>({...x,score:score(x)})).filter(x=>x.score>=2.3).sort((a,b)=>b.score-a.score||(a.index??0)-(b.index??0));
 const unique=[],seen=new Set();ranked.forEach(h=>{const key=(h.source.documentId||h.source.noteId||h.source.label)+'|'+(h.page??'');if(!seen.has(key)&&unique.length<5){seen.add(key);unique.push(h)}});
 if(!unique.length)return {answer:'I couldn’t find a matching passage. Try the course code (AEC, VAC, SEC), the date, or a short phrase from the document. Check the extracted text in My Knowledge if the image is unclear.',sources:[]};
 const sourceLabels=unique.map(h=>h.source.file?h.source.label+' — attachment: '+h.source.file+(h.page?' · Page '+h.page:(h.page===null?' · Page unavailable':'')):h.source.label);
 return {answer:unique.slice(0,3).map((h,i)=>(i+1)+'. '+h.text+(h.page?' (Page '+h.page+')':'')).join('\n\n'),sources:sourceLabels};
}
function sendChat(q){q=(q||'').trim();if(!q||chatBusy)return;data.messages.push({role:'user',content:q});const r=aiAnswer(q);data.messages.push({role:'assistant',content:r.answer,sources:r.sources});persist();render();scrollChatToBottom()}
function action(name,id){const map={ 'new-note':()=>openForm('note'),'voice-quick-command':()=>{if(window.startStudentBrainListening)window.startStudentBrainListening();else toast('Voice assistant is loading. Try again.');},'edit-note':()=>openForm('note',id),'delete-note':()=>confirmDelete('notes',id),'delete-document':()=>{data.documents=(data.documents||[]).filter(d=>d.id!==id);persist();render();toast('Document deleted')},'retry-document-ocr':()=>retryDocumentOCR(id),'ask-document':()=>askDocument(id),'new-task':()=>openForm('task'),'enable-reminders':()=>enableTaskReminders(),'new-study':()=>openForm('study'),'edit-task':()=>openForm('task',id),'delete-task':()=>confirmDelete('tasks',id),'new-project':()=>openForm('project'),'edit-project':()=>openForm('project',id),'new-expense':()=>openForm('expense'),'expense-quick-action':()=>{if(id==='all'){window.expenseMonth='';render()}else{openForm('expense');const field=document.querySelector('#edit-form [name=kind]');if(field)field.value=id}},'edit-expense':()=>openForm('expense',id),'delete-expense':()=>confirmDelete('expenses',id),'delete-study':()=>{data.studySessions=(data.studySessions||[]).filter(x=>x.id!==id);persist();render();toast('Study session removed')},'go-ask':()=>{page='ask';render()},'go-planner':()=>{page='planner';render()},'go-knowledge':()=>{page='knowledge';render()},'toggle-task':()=>{let t=data.tasks.find(x=>x.id===id);if(t)t.done=!t.done;persist();render()},'all-expenses':()=>{window.expenseMonth='';render()},'export-data':()=>exportData(),'restore-data':()=>restoreData(),'clear-data':()=>clearData(),'close-modal':()=>document.querySelector('#modal-root').innerHTML=''};map[name]?.()}
function confirmDelete(key,id){const item=data[key].find(x=>x.id===id);if(!item)return;if(confirm(`Delete "${item.title||item.name||item.description}"? This cannot be undone.`)){data[key]=data[key].filter(x=>x.id!==id);persist();render();toast('Deleted')}}
function restoreData(){const f=document.querySelector('#restore-file')?.files?.[0];if(!f){toast('Choose a JSON backup first');return}const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed||!Array.isArray(parsed.notes)||!Array.isArray(parsed.tasks))throw Error('Invalid backup');if(!confirm('Restore this backup and replace current workspace data?'))return;data={...starter(),...parsed};persist();page='overview';render();toast('Backup restored')}catch(e){toast('Invalid Student Brain backup file')}};reader.readAsText(f)}
function exportData(){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='student-brain-backup.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup downloaded')}
function restoreData(){const f=document.querySelector('#restore-file')?.files?.[0];if(!f){toast('Choose a JSON backup first');return}if(f.size>20*1024*1024){toast('Backup too large (20 MB maximum)');return}const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.notes)||!Array.isArray(parsed.tasks))throw Error('Invalid Student Brain backup');const next=migrateData(parsed);if(!confirm('Restore backup and replace current data? A safety snapshot will be saved first.'))return;localStorage.setItem(KEY+'-pre-restore',JSON.stringify(data));data=next;persist();page='overview';render();toast('Backup restored')}catch(err){console.error('Restore failed',err);toast(err.message||'Invalid backup file')}};reader.onerror=()=>toast('Could not read backup file');reader.readAsText(f)}
function clearData(){if(confirm('Delete all Student Brain data saved in this browser? Export first if you need a backup.')){data=starter();persist();render();toast('Local data cleared')}}
document.addEventListener('click',e=>{const backdrop=e.target.closest('.modal-backdrop');if(backdrop&&e.target===backdrop){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal')){const close=e.target.closest('[data-action="close-modal"]');if(close){e.preventDefault();e.stopPropagation();action('close-modal')}return}const close=e.target.closest('[data-action="close-modal"]');if(close){e.preventDefault();e.stopPropagation();action('close-modal');return}if(e.target.closest('.modal'))return;const pg=e.target.closest('[data-page]');if(pg){page=pg.dataset.page;history.pushState({sbPage:page},'',location.href);render();return}const a=e.target.closest('[data-action]');if(a){action(a.dataset.action,a.dataset.id);return}const q=e.target.closest('[data-question]');if(q){sendChat(q.dataset.question);return}});
document.addEventListener('submit',e=>{if(e.target.id==='edit-form')saveForm(e);if(e.target.id==='chat-form'){e.preventDefault();const i=document.querySelector('#chat-input');sendChat(i.value);}});
document.addEventListener('input',e=>{if(e.target.id==='note-search'){window.noteQuery=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}});
document.addEventListener('change',e=>{if(e.target.id==='document-upload')processUploadedDocuments(e.target.files);if(e.target.id==='subject-filter'){window.subjectFilter=e.target.value;const el=document.querySelector('#notes-list');if(el)el.innerHTML=notesCards()}if(e.target.id==='task-filter'){window.taskFilter=e.target.value;render()}if(e.target.id==='expense-month'){window.expenseMonth=e.target.value;render()}});

window.handleStudentBrainVoiceCommand = function(raw) {
 const text=String(raw||'').trim(), lower=text.toLowerCase();
 if(!text)return false;
 const m=text.match(/(?:₹|rs\.?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?:\s*(?:rupees?|rs\.?|रुपये|रुपए))?/i);
 const amount=m?Number(m[1].replace(/,/g,'')):null;
 const months={january:0,jan:0,february:1,feb:1,march:2,mar:2,april:3,apr:3,may:4,june:5,jun:5,july:6,jul:6,august:7,aug:7,september:8,sep:8,sept:8,october:9,oct:9,november:10,nov:10,december:11,dec:11};
 let due='';
 const dm=lower.match(/\b(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(\d{4}))?\b/i);
 if(dm){let y=dm[3]?+dm[3]:new Date().getFullYear(),mo=months[dm[2]];if(!dm[3]&&new Date(y,mo,+dm[1])<new Date(new Date().setHours(0,0,0,0)))y++;due=new Date(y,mo,+dm[1]).toISOString().slice(0,10)}
 else if(/\btomorrow\b|\bkal\b/i.test(lower)){let d=new Date();d.setDate(d.getDate()+1);due=d.toISOString().slice(0,10)}
 else if(/\btoday\b|\baaj\b/i.test(lower))due=new Date().toISOString().slice(0,10);
 else {const w=lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);if(w){const days={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};let d=new Date(),delta=(days[w[1]]-d.getDay()+7)%7||7;d.setDate(d.getDate()+delta);due=d.toISOString().slice(0,10)}}
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
 const taskCue=/\b(task|tasks|to[ -]?do|assignment|deadline|last date|due date|due|submit|exam|remind(?:er)?|project|homework|kaam|karna hai|yaad dilana|add kar(?:o|na)|bana(?:o|na))\b/i.test(lower);
 if(taskCue||due){
  let title=text
   .replace(/\b(?:please|mere liye|mere|mujhe|add|create|make|new|a|an|the|task|tasks|to[ -]?do|remind(?:er)?|yaad dilana|kar do|karna hai|bana do|banao|save|in planner)\b/ig,' ')
   .replace(/\b(?:kal|tomorrow|today|aaj|on|by|due|deadline|last date|submit karna hai|submit)\b/ig,' ')
   .replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title)title=text.trim();
  if(!confirm('Create task?\\n\\n'+title+'\\nDue: '+dateFmt(due))){toast('Task not saved');return true}
  data.tasks.push({id:uid(),title,category:/assignment|submit/i.test(lower)?'Assignment':/exam|paper/i.test(lower)?'Exam':/project/i.test(lower)?'Project':'Personal',due,priority:'Medium',done:false,updated:Date.now(),created:Date.now()});
  persist();page='planner';render();toast('Task saved to Planner');speakVoiceConfirmation('Task saved to Planner.');return true;
 }
 return false;
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
