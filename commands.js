/* Offline-first Ask One command parser. No network/API dependencies. */
(() => {
 const KEYWORDS={
  action:{add:['add','jodo','daalo','dalo','banao','create','likho','save','note karo','lagao','set','remind','reminder','yaad dilao','yaad dilana'],show:['dikhao','batao','show','list','kya hai','kitna','kitni','kitne','search','dhundo','find','open','kholo'],edit:['badlo','change','update','edit','rename'],delete:['delete','hatao','mita do','remove'],complete:['complete','done','ho gaya','khatam','finish']},
  section:{tasks:['task','tasks','todo','to do','kaam','remind','reminder','yaad dilao','yaad dilana'],notes:['note','notes','memo','idea','likha'],projects:['project','projects','milestone','progress'],routines:['routine','routines','habit','daily','roz','subah','raat'],money:['paisa','paise','kharcha','kharch','expense','expenses','income','budget','balance','spent','salary','udhaar','money'],files:['file','files','pdf','photo','image','document','bill','receipt'],scan:['scan','scanner']}
 };
 const norm=s=>String(s||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s₹./-]/gu,' ').replace(/\s+/g,' ').trim();
 const lev=(a,b)=>{if(Math.abs(a.length-b.length)>1)return 2;let r=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let n=[i];for(let j=1;j<=b.length;j++)n[j]=Math.min(n[j-1]+1,r[j]+1,r[j-1]+(a[i-1]===b[j-1]?0:1));if(Math.min(...n)>1)return 2;r=n;}return r[b.length]};
 const fuzzy=(q,w)=>{const n=norm(w);if(n.includes(' '))return q.includes(n);return q.split(' ').some(t=>t===n||(t.length>2&&n.length>2&&(t.includes(n)||n.includes(t)||lev(t,n)<=1)))};
 function detectIntent(query){const q=norm(query),scores={};for(const [k,words] of Object.entries(KEYWORDS.section)){scores[k]=words.reduce((s,w)=>s+(q.split(' ').includes(norm(w))?2:q.includes(norm(w))?1:q.split(' ').some(t=>t.length>2&&lev(t,norm(w))<=1)?1:0),0)}const hi=Math.max(0,...Object.values(scores)),wins=Object.keys(scores).filter(k=>scores[k]===hi&&hi>0);return {intent:wins.length===1?wins[0]:null,ambiguous:wins.length>1,matched:wins,scores}}
 const numberMap={ek:1,do:2,teen:3,char:4,chaar:4,paanch:5,panch:5,chhe:6,saat:7,aath:8,nau:9,das:10,bees:20,pachaas:50,sau:100,hundred:100,hazaar:1000,hajar:1000,thousand:1000,lakh:100000};
 function parseAmount(text){let m=text.match(/(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|hazaar|hazar|rupees?|rs\.?|रुपये|रुपए)?/i);if(m){let n=Number(m[1].replace(/,/g,''));return n*(m[2]&&/^(k|thousand|hazaar|hazar)$/i.test(m[2])?1000:1)}let total=0,cur=0,found=false;for(const t of norm(text).split(' ')){if(numberMap[t]!=null){found=true;const n=numberMap[t];if(n>=100){cur=(cur||1)*n;if(n>=1000){total+=cur;cur=0}}else cur+=n}}return found?total+cur:0}
 function parseDate(text){const q=norm(text),d=new Date(today()+'T12:00:00');if(/\b(aaj|today)\b/.test(q))return today();if(/\b(kal|tomorrow)\b/.test(q))d.setDate(d.getDate()+1);else if(/\b(parso|parson)\b/.test(q))d.setDate(d.getDate()+2);else{let m=q.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);if(m){let y=m[3]?Number(m[3]):Number(today().slice(0,4));if(y<100)y+=2000;const x=new Date(y,+m[2]-1,+m[1],12);if(x.getDate()===+m[1]&&x.getMonth()===+m[2]-1)return x.toISOString().slice(0,10)}else{const days={somvar:1,monday:1,mangalvar:2,tuesday:2,budhvar:3,wednesday:3,guruwar:4,thursday:4,shukravar:5,friday:5,shanivar:6,saturday:6,ravivar:0,sunday:0};let day=Object.keys(days).find(k=>q.includes(k));if(!day)return '';let delta=(days[day]-d.getDay()+7)%7;if(!delta||q.includes('agle'))delta=delta||7;d.setDate(d.getDate()+delta)}}return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
 function parseTime(text){const q=norm(text);let m=q.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/);if(!m)return '';let h=+m[1],min=+(m[2]||0);if(m[3]==='pm'&&h<12)h+=12;if(m[3]==='am'&&h===12)h=0;if(/\b(shaam|evening|raat)\b/.test(q)&&h<12)h+=12;if(/\b(subah|morning)\b/.test(q)&&h===12)h=0;return h<24&&min<60?String(h).padStart(2,'0')+':'+String(min).padStart(2,'0'):''}
 function autoExpenseCategory(text){
  const q=norm(text);
  if(/\b(chai|tea|coffee|breakfast|lunch|dinner|food|restaurant|grocery|groceries|pizza|snack|khana|nashta|sabzi|doodh)\b/.test(q))return 'Food';
  if(/\b(petrol|diesel|fuel|uber|ola|taxi|cab|bus|train|metro|flight|travel|hotel|trip|auto|rickshaw)\b/.test(q))return 'Travel';
  if(/\b(rent|electricity|bijli|water|internet|mobile bill|recharge)\b/.test(q))return 'Bills';
  if(/\b(medicine|doctor|hospital|pharmacy|medical)\b/.test(q))return 'Health';
  return 'Other';
 }
 function parseRecurrence(text){
  const q=norm(text);
  const days={sunday:0,somvar:1,monday:1,mangalvar:2,tuesday:2,budhvar:3,wednesday:3,guruwar:4,thursday:4,shukravar:5,friday:5,shanivar:6,saturday:6,ravivar:0};
  const dayKey=Object.keys(days).find(day=>q.split(' ').includes(day));
  const daily=/\b(daily|every day|roz|roj|har roz|har din)\b/i.test(q);
  const weekly=!!dayKey||/\b(weekly|every week|har hafte|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday|har somvar|har mangalvar|har budhvar|har guruwar|har shukravar|har shanivar|har ravivar)\b/i.test(q);
  const monthly=/\b(monthly|every month|each month|har mahine|mahine me ek baar|mahine mein ek baar)\b/i.test(q);
  return {repeatRule:daily?'daily':weekly?'weekly':monthly?'monthly':'none',repeatDay:dayKey?days[dayKey]:null};
 }
 function parseCommand(query){
  const q=norm(query),reminderCue=/\b(?:remind(?:er)?|yaad\s+(?:dila|dilana|dila do|dila dena|rakhna)|set\s+(?:a\s+)?reminder|reminder\s+(?:set|laga)|briefing)\b/i.test(q);
  const recurrence=parseRecurrence(q);
  const det=reminderCue?{intent:'tasks',ambiguous:false,matched:['tasks']}:detectIntent(q);
  const planSummary=/\b(aaj ka plan|today'?s plan|plan for today|aaj kya karna hai)\b/i.test(q);
  const weeklySpending=/\b(is hafte|iss hafte|this week|weekly)\b/i.test(q)&&/\b(kitna|kitni|kharcha|kharch|spent|spending|expense)\b/i.test(q);
  if(!det.intent&&recurrence.repeatRule!=='none')det.intent=/\b(routine|habit|walk|exercise|meditation)\b/i.test(q)?'routines':'tasks';
  if(planSummary)det.intent='tasks';
  let action=reminderCue?'add':Object.entries(KEYWORDS.action).find(([,ws])=>ws.some(w=>fuzzy(q,w)))?.[0]||'show';
  const amount=parseAmount(query);
  if(/\b(salary|income|received|credited|kamai|mila|mili|expense|kharcha|kharch|spent)\b/.test(q)&&amount)action='add';
  if(det.intent==='routines'&&/\b(routine|habit|daily|roz|roj|subah|raat|walk)\b/.test(q)&&!/\b(show|list|dikhao|batao|kitna|kya hai)\b/.test(q))action='add';
  if(recurrence.repeatRule!=='none'&&!/\b(show|list|dikhao|batao|search|dhundo)\b/.test(q))action='add';
  if(action==='complete'&&!det.intent)det.intent='tasks';
  if(action==='delete'&&!det.intent)det.intent='tasks';
  if(/\b(kitna|kitni|kitne|kya hai|how much|what is)\b/.test(q))action='show';
  if(planSummary||weeklySpending)action='summary';
  const date=parseDate(query),time=parseTime(query);
  let title=q.replace(/\b(add|jodo|daalo|dalo|banao|create|likho|save|dikhao|batao|show|list|search|dhundo|edit|update|delete|hatao|remove|complete|done|ho gaya|khatam|finish|task|tasks|todo|note|notes|project|routine|habit|paisa|paise|money|kharcha|kharch|expense|expenses|income|salary|aayi|aaya|file|files|pdf|photo|image|please|kar do|karo|mein|me|ka|ki|ke|hai|hain|subah|baje|morning|evening|raat|tomorrow|kal|aaj|roz|roj|daily|milestone|naya|new|wala|wali|wale|rupees|rupee|rupaye|rupay|रुपये|रुपए|rs|remind|reminder|yaad|dilana|dilao|kholo|open|am|pm|oclock|ek|do|teen|char|chaar|paanch|panch|chhe|saat|aath|nau|das|bees|sau|hazaar|hajar|har|every|week|weekly|somvar|monday|mangalvar|tuesday|budhvar|wednesday|guruwar|thursday|shukravar|friday|shanivar|saturday|ravivar|sunday)\b/gi,' ')
   .replace(/\b\d[\d,]*(?:\.\d+)?\b/g,' ').replace(/\s+/g,' ').trim();
  const projectName=(q.match(/\bproject\s+([\p{L}\p{N}_-]+)/u)||[])[1]||'';
  if(det.intent==='projects'&&/\bmilestone\b/.test(q))title='New milestone';
  const summary=planSummary?'today-plan':weeklySpending?'week-spending':null;
  return {action,section:det.intent,ambiguous:det.ambiguous,matched:det.matched,amount,date,time,title,projectName,query,summary,...recurrence};
 }

 let pending=null, pendingReminderDraft=null;
 function answer(text,source){return {answer:text,sources:[source||'Ask One']}}
 function executeCommand(query){const q=norm(query);if(pending){const p=pending;if(p.choose){const n=Number(q);if(!Number.isInteger(n)||n<1||n>p.choose.length)return answer('List me se number reply karo, jaise 1 ya 2.');const item=p.choose[n-1];pending=null;if(p.action==='delete'){pending={apply:()=>{data[p.collection]=data[p.collection].filter(x=>x.id!==item.id);persist();render()},done:'Deleted '+(item.title||item.name||item.description)};return answer('Ye delete karna hai: "'+(item.title||item.name||item.description)+'"? Haan / Nahi bolo.')}if(p.action==='complete'&&p.collection==='tasks'){pending={apply:()=>{item.done=true;item.completedAt=Date.now();persist();render()},done:'Completed '+item.title};return answer('Mark "'+item.title+'" complete? Haan / Nahi bolo.')}return answer(item.title||item.name||item.description||'Selected item')}pending=null;if(/^(haan|ha|yes|y|confirm|kar do|proceed)$/.test(q)){p.apply();return answer(p.done,'Ask One')}if(/^(nahi|na|no|n|cancel)$/.test(q))return answer('Cancelled. Koi change nahi kiya.');pending=p;return answer('Pending action ke liye Haan ya Nahi bolo.')}
 const reminderCue=/\b(?:remind(?:er)?|yaad\s+(?:dila|dilana|dila do|dila dena|rakhna)|set\s+(?:a\s+)?reminder|reminder\s+(?:set|laga)|briefing)\b/i.test(q);
 if(reminderCue||pendingReminderDraft){
  const combined=pendingReminderDraft?pendingReminderDraft+' '+query:query;
  const due=parseDate(combined),time=parseTime(combined);
  const title=norm(combined).replace(/\b(remind(?:er)?|set|laga|lagao|laga do|set karo|set kar do|yaad|dila|dilana|dila do|dila dena|rakhna|briefing|brief me|mujhe|mere|please|karo|karna|kar|me|to|the|a|an|for|liya|liye|ke liye|ko|ka|ki|ke|kal|tomorrow|aaj|today|parso|parson|subah|morning|shaam|sham|evening|raat|night|at|baje|am|pm|daily|every day|roz|har roz|har din)\b/gi,' ')
   .replace(/\b\d{1,2}(?::\d{2})?\b/g,' ').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  if(!title){pendingReminderDraft=combined;return answer('Kis baat ka reminder set karna hai? Example: assignment, bill pay karna, ya kisi ko call karna.','Task Briefing')}
  if(!due){pendingReminderDraft=combined;return answer('“'+title+'” ka reminder kis din set karna hai? Jaise kal, Friday ya 20/11.','Task Briefing')}
  const repeat=parseRecurrence(combined),repeatRule=repeat.repeatRule;
  const r={id:uid(),title,due:due||(repeatRule!=='none'?today():''),reminderTime:time||'09:00',priority:'Medium',category:'Briefing',repeatRule,repeatDay:repeat.repeatDay,done:false,created:Date.now(),updated:Date.now(),notes:'Created through Ask One reminder command.'};
  pendingReminderDraft=null;data.tasks.push(r);persist();
  window.OneCommandsUndo=()=>{data.tasks=data.tasks.filter(x=>x.id!==r.id);persist();render()};
  window.OneCommandsShowUndo?.();render();
  return answer('Reminder set: '+r.title+' · '+dateFmt(r.due)+' at '+r.reminderTime+(repeatRule!=='none'?' · Repeats '+repeatRule:''),'Task Briefing');
 }
 const p=parseCommand(query),s=p.section;if(!s)return null;
 const collection={tasks:'tasks',notes:'notes',projects:'projects',routines:'routines',money:'expenses',files:'documents'}[s],arr=()=>Array.isArray(data[collection])?data[collection]:[];
 const terms=norm(p.title||query).split(' ').filter(t=>t.length>2&&!Object.values(KEYWORDS.section).flat().map(norm).includes(t)&&!['dikhao','batao','show','list','pending','complete','delete','money','income','expense','expenses','kharcha','routine','tasks','task','notes','note','wala','wali','wale','please'].includes(t));
 const rows=arr().map(x=>{const hay=norm([x.title,x.name,x.description,x.content,x.note,x.tags,x.subject].flat().join(' '));return {x,score:terms.reduce((n,t)=>n+(hay.split(' ').includes(t)?2:hay.includes(t)?1:0),0)}}).filter(x=>!terms.length||x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.x);
 if(p.action==='add'){
  if(s==='scan'){const picker=document.createElement('input');picker.type='file';picker.accept='image/*';picker.capture='environment';picker.onchange=()=>{const file=picker.files?.[0];if(file)openFileMetadataDialog(file)};picker.click();return answer('Camera scan khul gaya. Document ki photo lo, phir save karo.','Scan')}if(s==='files'){openUploadForm();return answer('File picker khul gaya. PDF ya photo choose karo.','Uploaded Items')}
  if(s==='tasks'){if(!p.title)return answer('Task ka naam batao.');const repeat=p.repeatRule||'none',due=p.date||(repeat!=='none'?today():'');const r={id:uid(),title:p.title,due,reminderTime:p.time,priority:'Medium',category:/\b(remind|reminder|yaad dilao|yaad dilana)\b/.test(q)?'Briefing':'Task',repeatRule:repeat,repeatDay:p.repeatDay,done:false,created:Date.now(),updated:Date.now()};data.tasks.push(r);persist();window.OneCommandsUndo=()=>{data.tasks=data.tasks.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Task added: '+r.title+(r.due?' · '+dateFmt(r.due):'')+(r.reminderTime?' · '+r.reminderTime:'')+(repeat!=='none'?' · Repeats '+repeat:''),'Tasks')}
  if(s==='notes'){if(!p.title)return answer('Note ka content batao.');const r={id:uid(),title:'Quick note',content:p.title,subject:'Quick capture',tags:'ask one',created:Date.now(),updated:Date.now()};data.notes.unshift(r);persist();window.OneCommandsUndo=()=>{data.notes=data.notes.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Note saved.','Notes')}
  if(s==='money'){if(!p.amount)return answer('Amount batao. Example: 500 rupaye chai pe kharcha jodo.');const income=/\b(income|salary|aayi|aaya|received|credited)\b/.test(q),r={id:uid(),amount:p.amount,kind:income?'income':'expense',description:(income?'Salary':p.title.replace(/\\b\\d[\\d,]*(?:\\.\\d+)?\\b/g,'').replace(/\\b(rupees?|rupaye|rupay|rs|pe|salary|aayi|aaya)\\b/gi,'').trim()||'Expense'),category:income?'Salary':autoExpenseCategory(q),tags:income?['income','salary']: [autoExpenseCategory(q).toLowerCase(),...(/chai|tea|coffee/.test(q)?['chai']:[])],date:p.date||today(),created:Date.now(),updated:Date.now()};data.expenses.push(r);persist();window.OneCommandsUndo=()=>{data.expenses=data.expenses.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();window.moneyTab=income?'income':'spending';render();return answer((income?'Income':'Expense')+' saved: '+money(r.amount)+' · '+r.description,'Money')}
  if(s==='routines'){data.routines=data.routines||[];if(!p.title)return answer('Routine ka naam batao.');const r={id:uid(),title:p.title,frequency:p.repeatRule==='none'?(/daily|roz|roj/.test(q)?'daily':'weekly'):p.repeatRule,repeatRule:p.repeatRule||'none',repeatDay:p.repeatDay,time:p.time||'',created:Date.now(),updated:Date.now()};data.routines.push(r);persist();window.OneCommandsUndo=()=>{data.routines=data.routines.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Routine added: '+r.title,'Routines')}
  if(s==='projects'){if(!p.title)return answer('Project ya milestone ka naam batao.');let project=data.projects.find(x=>norm(x.name||x.title).includes(norm(p.projectName||p.title).split(' ')[0]));if(project){project.milestones=project.milestones||[];const milestone={id:uid(),title:p.title,done:false,created:Date.now()};project.milestones.push(milestone);persist();window.OneCommandsUndo=()=>{project.milestones=project.milestones.filter(x=>x.id!==milestone.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Milestone added to '+(project.name||project.title),'Projects')}const r={id:uid(),name:p.title,description:'',milestones:[],created:Date.now(),updated:Date.now()};data.projects.push(r);persist();window.OneCommandsUndo=()=>{data.projects=data.projects.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Project created: '+r.name,'Projects')}
 }
 if(p.action==='summary'&&p.summary==='week-spending'){
  const [yy,mm,dd]=today().split('-').map(Number);const end=new Date(Date.UTC(yy,mm-1,dd));const start=new Date(end);start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));const from=start.toISOString().slice(0,10),to=today();
  const entries=(data.expenses||[]).filter(x=>(x.date||'')>=from&&(x.date||'')<=to);
  const spent=entries.filter(x=>!['income','lent_repayment','borrowed_repayment'].includes(x.kind)).reduce((n,x)=>n+Number(x.amount||0),0);
  const income=entries.filter(x=>x.kind==='income').reduce((n,x)=>n+Number(x.amount||0),0);
  const categories={};entries.filter(x=>!['income','lent_repayment','borrowed_repayment'].includes(x.kind)).forEach(x=>{const k=x.category||'Other';categories[k]=(categories[k]||0)+Number(x.amount||0)});
  const breakdown=Object.entries(categories).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+': '+money(v)).join(' · ');
  return answer('Is hafte ka kharcha ('+dateFmt(from)+' – '+dateFmt(to)+'): '+money(spent)+'. Income: '+money(income)+(breakdown?'. Categories: '+breakdown:''),'Money summary');
 }
 if(p.action==='summary'&&p.summary==='today-plan'){
  const date=today(),pending=(data.tasks||[]).filter(x=>!x.done&&x.due&&x.due<=date).sort((a,b)=>String(a.reminderTime||'99:99').localeCompare(String(b.reminderTime||'99:99')));
  const weekday=new Date(date+'T12:00:00').getDay();const routineRows=(data.routines||[]).filter(x=>x.frequency==='daily'||x.repeatRule==='daily'||(x.repeatRule==='weekly'&&Number(x.repeatDay)===weekday));
  const lines=[...pending.map(x=>(x.due<date?'Overdue':'Today')+' · '+(x.reminderTime||'No time')+' · '+x.title),...routineRows.map(x=>(x.time||'Routine')+' · '+x.title)];
  return answer('Aaj ka plan:\n'+(lines.length?lines.join('\n'):'Aaj koi scheduled task ya routine nahi hai.')+'\nPending tasks: '+(data.tasks||[]).filter(x=>!x.done).length,'Today plan');
 }
 if(p.action==='show'){if(s==='tasks'&&/\b(pending|incomplete|open|baaki)\b/.test(q)){const a=data.tasks.filter(x=>!x.done);return answer(a.length?a.map((x,i)=>(i+1)+'. '+x.title+(x.due?' · '+dateFmt(x.due):'')).join('\n'):'No pending tasks.','Tasks')}if(s==='money'&&/\b(is mahine|this month|monthly)\b/.test(q)){const month=today().slice(0,7),a=data.expenses.filter(x=>(x.date||'').startsWith(month)),n=a.filter(x=>(x.kind||'expense')==='expense').reduce((v,x)=>v+Number(x.amount||0),0);return answer('This month spending: '+money(n),'Money')}if(rows.length===1&&s==='files'){openUploadedFile(rows[0].id,false);return answer('Opening '+rows[0].name,'Uploaded Items')}if(rows.length)return answer(rows.slice(0,8).map((x,i)=>(i+1)+'. '+(x.title||x.name||x.description||x.content||'Saved item')).join('\n'),s);return answer('Mujhe iske baare mein kuch nahi mila. Aap Tasks, Notes, Projects, Routines, Money ya Files try kar sakte ho.')}
 if(s==='files'&&p.action==='delete')return answer('File delete karne ke liye Uploaded Items section use karo, taaki original file bhi safely remove ho.','Uploaded Items');
 if(['delete','edit','complete'].includes(p.action)){if(rows.length>1){pending={choose:rows,action:p.action,collection};return answer('Kaunsa item? Number choose karo:\n'+rows.slice(0,5).map((x,i)=>(i+1)+') '+(x.title||x.name||x.description)).join('\n'))}if(!rows.length)return answer('Matching item nahi mila. Koi change nahi kiya.');const item=rows[0];if(p.action==='edit'){const m=q.match(/\b(?:to|as|naam)\s+(.+)$/);if(!m)return answer('Naya naam bhi likho. Example: rename gym task to evening gym.');const next=m[1].trim();pending={apply:()=>{if(item.title)item.title=next;else if(item.name)item.name=next;else if(item.description)item.description=next;item.updated=Date.now();persist();render()},done:'Updated name to '+next};return answer('Ye change karna hai? "'+(item.title||item.name||item.description)+'" → "'+next+'"? Haan / Nahi bolo.')}if(p.action==='complete'&&s==='tasks'){item.done=true;item.completedAt=Date.now();item.updated=Date.now();persist();render();return answer('Completed '+item.title+'.','Tasks')}pending={apply:()=>{data[collection]=arr().filter(x=>x.id!==item.id);persist();render()},done:'Deleted '+(item.title||item.name||item.description)};return answer('Ye delete karna hai: "'+(item.title||item.name||item.description)+'"? Haan / Nahi bolo.')}
 return null;
 }
 function historyKey(){return 'one-ask-command-history-v1-'+(typeof workspaceStorageKey==='function'?workspaceStorageKey():'guest')}function history(){try{return JSON.parse(localStorage.getItem(historyKey())||'[]').slice(0,20)}catch{return []}}function remember(q){const value=String(q||'').trim();if(!value)return;try{localStorage.setItem(historyKey(),JSON.stringify([value,...history().filter(x=>x!==value)].slice(0,20)))}catch{}}window.OneCommands={KEYWORDS,detectIntent,parseCommand,executeCommand,hasPending:()=>!!pending,hasPendingReminder:()=>!!pendingReminderDraft,history,remember};
})();