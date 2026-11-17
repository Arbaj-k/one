/* Offline-first Ask One command parser. No network/API dependencies. */
(() => {
 const KEYWORDS={
  action:{add:['add','jodo','daalo','dalo','banao','create','likho','save','remember','note karo','lagao','set','remind','reminder','yaad dilao','yaad dilana'],show:['dikhao','batao','show','list','kya hai','kitna','kitni','kitne','search','dhundo','find','open','kholo'],edit:['badlo','change','update','edit','rename'],delete:['delete','hatao','mita do','remove'],complete:['complete','done','mark','finished','ho gaya','khatam','finish'],pause:['pause','paused','rok do','band karo'],resume:['resume','unpause','restart','chalu karo','phir se chalao']},
  section:{tasks:['task','tasks','todo','to do','kaam'],reminders:['reminder','reminders','remind','yaad dilao','yaad dilana','briefing'],notes:['note','notes','memo','idea','likha'],projects:['project','projects','milestone','progress'],routines:['routine','routines','habit','daily','roz','subah','raat'],money:['paisa','paise','kharcha','kharch','expense','expenses','income','budget','balance','spent','salary','udhaar','money','received','credited','earned','paid','lent','borrowed','repayment','settle','settled','lent','borrowed','received','paid'],files:['file','files','pdf','photo','image','document','bill','receipt'],scan:['scan','scanner']}
 };
 const norm=s=>String(s||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s₹./:-]/gu,' ').replace(/\s+/g,' ').trim();
 const lev=(a,b)=>{if(Math.abs(a.length-b.length)>1)return 2;let r=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let n=[i];for(let j=1;j<=b.length;j++)n[j]=Math.min(n[j-1]+1,r[j]+1,r[j-1]+(a[i-1]===b[j-1]?0:1));if(Math.min(...n)>1)return 2;r=n;}return r[b.length]};
 const fuzzy=(q,w)=>{const n=norm(w);if(n.includes(' '))return q.includes(n);return q.split(' ').some(t=>t===n||(t.length>2&&n.length>2&&(t.includes(n)||n.includes(t)||lev(t,n)<=1)))};
 function detectIntent(query){const q=norm(query),scores={};for(const [k,words] of Object.entries(KEYWORDS.section)){scores[k]=words.reduce((s,w)=>s+(q.split(' ').includes(norm(w))?2:q.includes(norm(w))?1:q.split(' ').some(t=>t.length>2&&lev(t,norm(w))<=1)?1:0),0)}const hi=Math.max(0,...Object.values(scores)),wins=Object.keys(scores).filter(k=>scores[k]===hi&&hi>0);return {intent:wins.length===1?wins[0]:null,ambiguous:wins.length>1,matched:wins,scores}}
 const numberMap={ek:1,do:2,teen:3,char:4,chaar:4,paanch:5,panch:5,chhe:6,saat:7,aath:8,nau:9,das:10,bees:20,pachaas:50,sau:100,hundred:100,hazaar:1000,hajar:1000,thousand:1000,lakh:100000};
 function parseAmount(text){
  const input=String(text||'');
  const matches=[...input.matchAll(/(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|hazaar|hazar|rupees?|rs\.?|रुपये|रुपए)?/gi)];
  for(const match of matches){
   const before=input.slice(0,match.index),after=input.slice(match.index+match[0].length);
   if(/^\s*(?:am|pm|baje)\b/i.test(after)||/^\s*[:/]\s*\d/.test(after)||/\d\s*\/\s*$/.test(before)||/(?:\bat|\btime|\bdate)\s*$/i.test(before))continue;
   const value=Number(match[1].replace(/,/g,''));
   if(!Number.isFinite(value))continue;
   return value*(/^(?:k|thousand|hazaar|hazar)$/i.test(match[2]||'')?1000:1);
  }
  let total=0,cur=0,found=false;
  for(const token of norm(input).split(' ')){
   if(numberMap[token]!=null){found=true;const n=numberMap[token];if(n>=100){cur=(cur||1)*n;if(n>=1000){total+=cur;cur=0}}else cur+=n}
  }
  return found?total+cur:0;
 }
 function parseDate(text){const q=norm(text),d=new Date(today()+'T12:00:00');if(/\b(aaj|today)\b/.test(q))return today();if(/\b(kal|tomorrow)\b/.test(q))d.setDate(d.getDate()+1);else if(/\b(parso|parson)\b/.test(q))d.setDate(d.getDate()+2);else{let m=q.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);if(m){let y=m[3]?Number(m[3]):Number(today().slice(0,4));if(y<100)y+=2000;const x=new Date(y,+m[2]-1,+m[1],12);if(x.getDate()===+m[1]&&x.getMonth()===+m[2]-1)return x.toISOString().slice(0,10)}else{const days={somvar:1,monday:1,mangalvar:2,tuesday:2,budhvar:3,wednesday:3,guruwar:4,thursday:4,shukravar:5,friday:5,shanivar:6,saturday:6,ravivar:0,sunday:0};let day=Object.keys(days).find(k=>q.includes(k));if(!day)return '';let delta=(days[day]-d.getDay()+7)%7;if(!delta||q.includes('agle'))delta=delta||7;d.setDate(d.getDate()+delta)}}return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
 function parseTime(text){
  const q=norm(text);
  const match=q.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))\s*(am|pm)?(?=\s|$)|\b(\d{1,2})\s*(am|pm|baje)(?=\s|$)|\b(subah|morning|shaam|sham|evening|raat|night)\s+(\d{1,2})(?::(\d{2}))?(?=\s|$)/i);
  if(!match)return '';
  let h=Number(match[1]||match[4]||match[7]),min=Number(match[2]||match[8]||0);
  const meridiem=String(match[3]||match[5]||'').toLowerCase();
  const period=String(match[6]||'').toLowerCase();
  if(meridiem==='pm'||/^(shaam|sham|evening|raat|night)$/.test(period)){if(h<12)h+=12}
  if(meridiem==='am'||/^(subah|morning)$/.test(period)){if(h===12)h=0}
  return h<24&&min<60?String(h).padStart(2,'0')+':'+String(min).padStart(2,'0'):'';
 }
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
  const workTaskAdd=/\b(?:assignment|assignments|homework|exam|exams)\b/i.test(q)&&/\b(?:add|create|make|banao|bana|jodo|daalo|dalo|set|likho|save)\b/i.test(q);
  const taskManagementCue=/\b(?:mark|complete|finish|done|delete|remove|edit|update)\b/i.test(q)&&/\b(?:assignment|assignments|homework|exam|exams)\b/i.test(q);
  const det=reminderCue?{intent:'reminders',ambiguous:false,matched:['reminders']}:workTaskAdd||taskManagementCue?{intent:'tasks',ambiguous:false,matched:['tasks']}:detectIntent(q);
  const planSummary=/\b(aaj ka plan|today'?s plan|plan for today|aaj kya karna hai)\b/i.test(q);
  const weeklySpending=/\b(is hafte|iss hafte|this week|weekly)\b/i.test(q)&&/\b(kitna|kitni|kharcha|kharch|spent|spending|expense)\b/i.test(q);
  const dailySpending=/\b(aaj|today)\b/i.test(q)&&/\b(kharcha|kharch|spent|spending|expense|expenses)\b/i.test(q);
  const udhaarSummary=/\b(who owes me|who do i owe|how much do i owe|mere paise kis ke paas|kis se paise lene|kisko paise dene|udhaar summary)\b/i.test(q);
  const explicitRecurringCommand=reminderCue||/\b(?:daily|every day|roz|roj|har roz|har din|weekly|every week|har hafte|monthly|every month|each month|har mahine|mahine me ek baar|mahine mein ek baar)\b/i.test(q)||/\b(?:add|create|make|save|schedule|set)\b.{0,30}\b(?:task|todo|reminder|routine|habit)\b/i.test(q);
// A weekday alone is a lookup filter, not a task or reminder.
if(!det.intent&&recurrence.repeatRule!=='none'&&explicitRecurringCommand)det.intent=/\b(routine|habit|walk|exercise|meditation)\b/i.test(q)?'routines':'tasks';
  if(planSummary)det.intent='tasks';
  const readVerb=/\b(?:show|list|display|tell|batao|dikhao|sunao|what|which|when|where|how|kitna|kitne|kitni|kya\s+(?:set|saved|scheduled|hai))\b/i.test(q);
  const writeVerb=/\b(?:add|create|make|save|record|log|schedule|set|lagao|laga|banao|bana|jodo|daalo|dalo|yaad\s+dila)\b/i.test(q);
  let action=readVerb?'show':writeVerb?'add':reminderCue?'add':Object.entries(KEYWORDS.action).find(([,ws])=>ws.some(w=>fuzzy(q,w)))?.[0]||'show';
  const amount=parseAmount(query);
  const udhaarType=/\b(?:udhaar|lent|lend|gave|given|diye|diya|borrowed|borrow|liya|liye|repaid|repayment|settle|settled|paid back|wapas)\b/i.test(q)?(/\b(?:borrowed|borrow|liya|liye|udhaar liya)\b/i.test(q)?'borrowed':/\b(?:repaid|repayment|settle|settled|paid back|wapas)\b/i.test(q)?(/\b(?:borrowed|liya)\b/i.test(q)?'borrowed_repayment':'lent_repayment'):'lent'):'';
  const person=(q.match(/\bto\s+([\p{L}][\p{L}'-]*)/iu)||q.match(/\b([\p{L}][\p{L}'-]*)\s+ko\b/iu)||q.match(/\bfrom\s+([\p{L}][\p{L}'-]*)/iu)||q.match(/\bwith\s+([\p{L}][\p{L}'-]*)/iu)||[])[1]||'';
  if((/\b(salary|income|received|credited|kamai|mila|mili|expense|kharcha|kharch|spent)\b/.test(q)||udhaarType)&&amount)action='add';
  if(det.intent==='routines'&&/\b(routine|habit|daily|roz|roj|subah|raat|walk)\b/.test(q)&&!/\b(show|list|dikhao|batao|kitna|kya hai)\b/.test(q))action='add';
  if(recurrence.repeatRule!=='none'&&!/\b(show|list|dikhao|batao|search|dhundo)\b/.test(q))action='add';
  if(action==='complete'&&!det.intent)det.intent='tasks';
  if(action==='delete'&&!det.intent)det.intent='tasks';
  if(/\b(kitna|kitni|kitne|kya hai|how much|what is)\b/.test(q))action='show';
  if(planSummary||weeklySpending||dailySpending||udhaarSummary)action='summary';
  const date=parseDate(query),time=parseTime(query);
  let title=q
   .replace(/\b(?:please|kindly|add|jodo|daalo|dalo|banao|bana|create|likho|save|task|tasks|todo|assignment|assignments|homework|exam|exams|reminder|remind|yaad|dila|dilana|briefing|note|notes|project|routine|habit|paisa|paise|money|kharcha|kharch|expense|expenses|income|salary|set|schedule|kar do|karo|karna|mujhe|mere liye|mark|complete|finish|done|delete|remove|edit|update|do)\b/gi,' ')
   .replace(/\b(?:today|aaj|tomorrow|kal|parso|parson|daily|every day|weekly|monthly|every week|every month|roz|roj|har roz|har din|subah|morning|evening|shaam|sham|raat|night|at|baje|am|pm|oclock)\b/gi,' ')
   .replace(/\b(?:due|on)\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gi,' ')
   .replace(/\b(?:on|due)\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gi,' ')
   .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b/gi,' ')
   .replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  const projectName=(q.match(/\bproject\s+([\p{L}\p{N}_-]+)/u)||[])[1]||'';
  if(det.intent==='projects'&&/\bmilestone\b/.test(q))title='New milestone';
  const summary=planSummary?'today-plan':weeklySpending?'week-spending':dailySpending?'today-spending':udhaarSummary?'udhaar-summary':null;
  return {action,section:det.intent,ambiguous:det.ambiguous,matched:det.matched,amount,date,time,title,projectName,query,summary,udhaarType,person,...recurrence};
 }

 let pending=null, pendingReminderDraft=null, pendingExpiresAt=0, reminderDraftExpiresAt=0;
 function answer(text,source){return {answer:text,sources:[source||'Ask One']}}
 function executeCommand(query){const q=norm(query);if(pending&&Date.now()>pendingExpiresAt){pending=null;pendingExpiresAt=0;}if(pending&&!/^(?:haan|ha|yes|y|ok|okay|theek hai|theek|kar do|confirm|proceed|nahi|na|no|n|cancel|rehne do|mat karo|stop|\d+)$/i.test(q)){pending=null;pendingExpiresAt=0;}if(pending){const p=pending;if(p.choose){const n=Number(q);if(!Number.isInteger(n)||n<1||n>p.choose.length)return answer('List me se number reply karo, jaise 1 ya 2.');const item=p.choose[n-1];pending=null;if(p.action==='delete'){pending={apply:()=>{data[p.collection]=data[p.collection].filter(x=>x.id!==item.id);persist();render()},done:'Deleted '+(item.title||item.name||item.description)};return answer('Ye delete karna hai: "'+(item.title||item.name||item.description)+'"? Haan / Nahi bolo.')}if(p.action==='complete'&&p.collection==='tasks'){pending={apply:()=>{item.done=true;item.completedAt=Date.now();persist();render()},done:'Completed '+item.title};return answer('Mark "'+item.title+'" complete? Haan / Nahi bolo.')}return answer(item.title||item.name||item.description||'Selected item')}pending=null;if(/^(haan|ha|yes|y|ok|okay|theek hai|theek|confirm|kar do|proceed)$/.test(q)){p.apply();return answer(p.done,'Ask One')}if(/^(nahi|na|no|n|cancel|rehne do|mat karo|stop)$/.test(q))return answer('Cancelled. Koi change nahi kiya.');pending=p;return answer('Pending action ke liye Haan ya Nahi bolo.')}
 if(pendingReminderDraft&&/^(?:cancel|no|nahi|rehne do|mat karo|stop)$/i.test(q)){pendingReminderDraft=null;reminderDraftExpiresAt=0;return answer('Reminder draft cancelled. Koi reminder save nahi hua.','Task Briefing')}
 const reminderLookup=/\b(?:reminders?|briefings?)\b/i.test(q)&&/\b(?:show|list|tell|what|which|when|batao|dikhao|kya|kaun|set|saved|scheduled|hai|hain)\b/i.test(q);
 if(reminderLookup){
  const rows=(data.tasks||[]).filter(item=>item.category==='Briefing'||item.isReminder===true||item.source==='reminder');
  const active=rows.filter(item=>!item.done&&!item.paused).sort((a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999'))||String(a.reminderTime||'').localeCompare(String(b.reminderTime||'')));
  const list=active.length?active.map((item,index)=>(index+1)+'. '+item.title+' · '+(item.due?dateFmt(item.due):'Date not set')+' at '+(item.reminderTime||'09:00')+((item.repeatRule&&item.repeatRule!=='none')?' · '+item.repeatRule:'')).join('\n'):'Abhi koi active reminder saved nahi hai.';
  return answer('Your saved reminders:\n'+list,'Task Briefing');
 }
 const reminderCue=/\b(?:remind(?:er)?|yaad\s+(?:dila|dilana|dila do|dila dena|rakhna)|set\s+(?:a\s+)?reminder|reminder\s+(?:set|laga)|briefing)\b/i.test(q);
 if(pendingReminderDraft&&Date.now()>reminderDraftExpiresAt)pendingReminderDraft=null;if(pendingReminderDraft&&/^(?:add|create|make|show|list|delete|remove|complete|mark|save|note|task|expense|income|udhaar|project|routine)\b/i.test(q)){pendingReminderDraft=null;}if(reminderCue||pendingReminderDraft){
  const combined=pendingReminderDraft?pendingReminderDraft+' '+query:query;
  const repeat=parseRecurrence(combined),repeatRule=repeat.repeatRule,due=parseDate(combined)||(repeatRule!=='none'?today():''),time=parseTime(combined);
  const title=norm(combined).replace(/\b(remind(?:er)?|set|laga|lagao|laga do|set karo|set kar do|yaad|dila|dilana|dila do|dila dena|rakhna|briefing|brief me|mujhe|mere|please|karo|karna|kar|me|the|a|an|liya|liye|ke liye|ka|ki|ke|kal|tomorrow|aaj|today|parso|parson|subah|morning|shaam|sham|evening|raat|night|at|baje|am|pm|daily|every day|weekly|every week|monthly|every month|each month|every monday|every tuesday|every wednesday|every thursday|every friday|every saturday|every sunday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|somvar|mangalvar|budhvar|guruwar|shukravar|shanivar|ravivar|roz|har roz|har din|for)\b/gi,' ')
   .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b/gi,' ').replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim().replace(/^(?:to|for)\s+/i,'');
  if(!title){pendingReminderDraft=combined;reminderDraftExpiresAt=Date.now()+120000;return answer('Kis baat ka reminder set karna hai? Example: assignment, bill pay karna, ya kisi ko call karna.','Task Briefing')}
  if(!due){pendingReminderDraft=combined;reminderDraftExpiresAt=Date.now()+120000;return answer('“'+title+'” ka reminder kis din set karna hai? Jaise kal, Friday ya 20/11.','Task Briefing')}
  const r={id:uid(),title,due:due||(repeatRule!=='none'?today():''),reminderTime:time||'09:00',priority:'Medium',category:'Briefing',taskType:'reminder',isReminder:true,repeatRule,repeatDay:repeat.repeatDay,done:false,created:Date.now(),updated:Date.now(),notes:'Created through Ask One reminder command.'};
  pendingReminderDraft=null;data.tasks.push(r);persist();
  window.OneCommandsUndo=()=>{data.tasks=data.tasks.filter(x=>x.id!==r.id);persist();render()};
  window.OneCommandsShowUndo?.();render();
  return answer('Reminder set: '+r.title+' · '+dateFmt(r.due)+' at '+r.reminderTime+(repeatRule!=='none'?' · Repeats '+repeatRule:''),'Task Briefing');
 }
 const p=parseCommand(query),s=p.section;if(!s)return null;
 const collection={tasks:'tasks',reminders:'tasks',notes:'notes',projects:'projects',routines:'routines',money:'expenses',files:'documents'}[s],arr=()=>Array.isArray(data[collection])?data[collection]:[];
 const terms=norm(p.title||query).split(' ').filter(t=>t.length>2&&!Object.values(KEYWORDS.section).flat().map(norm).includes(t)&&!['dikhao','batao','show','list','pending','complete','delete','money','income','expense','expenses','kharcha','routine','tasks','task','notes','note','wala','wali','wale','please','mere','mera','meri','my','all','aaj','today','who','owes','me','ka','ki','ke'].includes(t));
 const rows=arr().filter(x=>s==='reminders'?(x.isReminder===true||x.taskType==='reminder'||x.category==='Briefing'):s==='tasks'?!(x.isReminder===true||x.taskType==='reminder'||x.category==='Briefing'):true).map(x=>{const hay=norm([x.title,x.name,x.description,x.content,x.note,x.tags,x.subject].flat().join(' '));return {x,score:terms.reduce((n,t)=>n+(hay.split(' ').includes(t)?2:hay.includes(t)?1:0),0)}}).filter(x=>!terms.length||x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.x);
 if(p.action==='add'){
  if(s==='scan'){const picker=document.createElement('input');picker.type='file';picker.accept='image/*';picker.capture='environment';picker.onchange=()=>{const file=picker.files?.[0];if(file)openFileMetadataDialog(file)};picker.click();return answer('Camera scan khul gaya. Document ki photo lo, phir save karo.','Scan')}if(s==='files'){openUploadForm();return answer('File picker khul gaya. PDF ya photo choose karo.','Uploaded Items')}
  if(s==='tasks'||s==='reminders'){if(!p.title)return answer(s==='reminders'?'Reminder kis baat ka set karna hai?':'Task ka naam batao.');const repeat=p.repeatRule||'none',due=p.date||(repeat!=='none'?today():''),isReminder=s==='reminders';const r={id:uid(),title:p.title,due,reminderTime:isReminder?(p.time||'09:00'):(p.time||''),priority:'Medium',category:isReminder?'Briefing':'Task',taskType:isReminder?'reminder':'task',isReminder,repeatRule:repeat,repeatDay:p.repeatDay,done:false,created:Date.now(),updated:Date.now()};data.tasks.push(r);persist();window.OneCommandsUndo=()=>{data.tasks=data.tasks.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer((isReminder?'Reminder set: ':'Task added: ')+r.title+(r.due?' · '+dateFmt(r.due):'')+(isReminder?' · '+r.reminderTime:'')+(repeat!=='none'?' · Repeats '+repeat:''),isReminder?'Reminders':'Tasks')}
  if(s==='notes'){if(!p.title)return answer('Note ka content batao.');const r={id:uid(),title:'Quick note',content:p.title,subject:'Quick capture',tags:'ask one',created:Date.now(),updated:Date.now()};data.notes.unshift(r);persist();window.OneCommandsUndo=()=>{data.notes=data.notes.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Note saved.','Notes')}
  if(s==='money'){if(!p.amount)return answer('Amount batao. Example: 500 rupaye chai pe kharcha jodo.');if(p.udhaarType){if(!p.person)return answer('Kis person ke saath udhaar hai? Example: Raj ko 500 udhaar diye.');const r={id:uid(),amount:p.amount,kind:p.udhaarType,person:p.person,description:(p.udhaarType.includes('repayment')?'Udhaar repayment':p.udhaarType==='borrowed'?'Borrowed':'Lent')+' · '+p.person,date:p.date||today(),created:Date.now(),updated:Date.now()};data.expenses.push(r);persist();window.OneCommandsUndo=()=>{data.expenses=data.expenses.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();window.moneyTab='udhaar';render();return answer('Udhaar saved: '+money(r.amount)+' · '+r.kind+' · '+r.person,'Money & Udhaar')}const income=/\b(income|salary|aayi|aaya|received|credited)\b/.test(q),r={id:uid(),amount:p.amount,kind:income?'income':'expense',description:(income?'Salary':p.title.replace(/\b\d[\d,]*(?:\.\d+)?\b/g,'').replace(/\b(rupees?|rupaye|rupay|rs|pe|salary|aayi|aaya)\b/gi,'').trim()||'Expense'),category:income?'Salary':autoExpenseCategory(q),tags:income?['income','salary']: [autoExpenseCategory(q).toLowerCase(),...(/chai|tea|coffee/.test(q)?['chai']:[])],date:p.date||today(),created:Date.now(),updated:Date.now()};data.expenses.push(r);persist();window.OneCommandsUndo=()=>{data.expenses=data.expenses.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();window.moneyTab=income?'income':'spending';render();return answer((income?'Income':'Expense')+' saved: '+money(r.amount)+' · '+r.description,'Money')}
  if(s==='routines'){data.routines=data.routines||[];if(!p.title)return answer('Routine ka naam batao.');const r={id:uid(),title:p.title,frequency:p.repeatRule==='none'?(/daily|roz|roj/.test(q)?'daily':'weekly'):p.repeatRule,repeatRule:p.repeatRule||'none',repeatDay:p.repeatDay,time:p.time||'',created:Date.now(),updated:Date.now()};data.routines.push(r);persist();window.OneCommandsUndo=()=>{data.routines=data.routines.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Routine added: '+r.title,'Routines')}
  if(s==='projects'){if(!p.title)return answer('Project ya milestone ka naam batao.');let project=data.projects.find(x=>norm(x.name||x.title).includes(norm(p.projectName||p.title).split(' ')[0]));if(project){project.milestones=project.milestones||[];const milestone={id:uid(),title:p.title,done:false,created:Date.now()};project.milestones.push(milestone);persist();window.OneCommandsUndo=()=>{project.milestones=project.milestones.filter(x=>x.id!==milestone.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Milestone added to '+(project.name||project.title),'Projects')}const r={id:uid(),name:p.title,description:'',milestones:[],created:Date.now(),updated:Date.now()};data.projects.push(r);persist();window.OneCommandsUndo=()=>{data.projects=data.projects.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Project created: '+r.name,'Projects')}
 }
 if(p.action==='summary'&&p.summary==='udhaar-summary'){
  const lent=new Map(),borrowed=new Map();
  for(const item of data.expenses||[]){
   const person=String(item.person||'').trim();if(!person)continue;
   if(item.kind==='lent')lent.set(person,(lent.get(person)||0)+Number(item.amount||0));
   if(item.kind==='lent_repayment')lent.set(person,(lent.get(person)||0)-Number(item.amount||0));
   if(item.kind==='borrowed')borrowed.set(person,(borrowed.get(person)||0)+Number(item.amount||0));
   if(item.kind==='borrowed_repayment')borrowed.set(person,(borrowed.get(person)||0)-Number(item.amount||0));
  }
  const owesMe=[...lent].filter(([,v])=>v>0),iOwe=[...borrowed].filter(([,v])=>v>0);
  const show=rows=>rows.length?rows.map(([name,value])=>name+' · '+money(value)).join('\n'):'None';
  return answer('Udhaar summary:\nPeople who owe you:\n'+show(owesMe)+'\n\nPeople you owe:\n'+show(iOwe),'Money & Udhaar');
 }
 if(p.action==='summary'&&p.summary==='today-spending'){
  const date=today(),rows=(data.expenses||[]).filter(x=>(x.date||'')===date&&(x.kind||'expense')==='expense');
  const total=rows.reduce((n,x)=>n+Number(x.amount||0),0);
  return answer('Aaj ka kharcha: '+money(total)+(rows.length?'\n'+rows.map(x=>(x.description||'Expense')+' · '+money(x.amount)).join('\n'):'\nAaj koi expense record nahi mila.'),'Money');
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
 if(p.action==='show'){if(s==='reminders'){const a=(data.tasks||[]).filter(x=>(x.isReminder===true||x.taskType==='reminder'||x.category==='Briefing')&&!x.done&&!x.paused);return answer(a.length?a.map((x,i)=>(i+1)+'. '+x.title+(x.due?' · '+dateFmt(x.due):'')+' · '+(x.reminderTime||'09:00')+(x.repeatRule&&x.repeatRule!=='none'?' · '+x.repeatRule:'')).join('\n'):'Abhi koi upcoming reminder nahi hai.','Reminders')}if(s==='tasks'&&/\b(pending|incomplete|open|baaki)\b/.test(q)){const a=data.tasks.filter(x=>!x.done&&!(x.isReminder===true||x.taskType==='reminder'||x.category==='Briefing'));return answer(a.length?a.map((x,i)=>(i+1)+'. '+x.title+(x.due?' · '+dateFmt(x.due):'')).join('\n'):'No pending tasks.','Tasks')}if(s==='money'&&/\b(is mahine|this month|monthly)\b/.test(q)){const month=today().slice(0,7),a=data.expenses.filter(x=>(x.date||'').startsWith(month)),n=a.filter(x=>(x.kind||'expense')==='expense').reduce((v,x)=>v+Number(x.amount||0),0);return answer('This month spending: '+money(n),'Money')}if(rows.length===1&&s==='files'){openUploadedFile(rows[0].id,false);return answer('Opening '+rows[0].name,'Uploaded Items')}if(rows.length)return answer(rows.slice(0,8).map((x,i)=>(i+1)+'. '+(x.title||x.name||x.description||x.content||'Saved item')).join('\n'),s);return answer('Mujhe iske baare mein kuch nahi mila. Aap Tasks, Notes, Projects, Routines, Money ya Files try kar sakte ho.')}
 if(s==='files'&&p.action==='delete')return answer('File delete karne ke liye Uploaded Items section use karo, taaki original file bhi safely remove ho.','Uploaded Items');
 if(['delete','edit','complete','pause','resume'].includes(p.action)){if(rows.length>1){pending={choose:rows,action:p.action,collection};pendingExpiresAt=Date.now()+120000;return answer('Kaunsa item? Number choose karo:\n'+rows.slice(0,5).map((x,i)=>(i+1)+') '+(x.title||x.name||x.description)).join('\n'))}if(!rows.length)return answer('Matching item nahi mila. Koi change nahi kiya.');const item=rows[0];if(p.action==='edit'){const m=q.match(/\b(?:to|as|naam)\s+(.+)$/);if(!m)return answer('Naya naam bhi likho. Example: rename gym task to evening gym.');const next=m[1].trim(),previous={title:item.title,name:item.name,description:item.description,updated:item.updated};pending={apply:()=>{if(item.title)item.title=next;else if(item.name)item.name=next;else if(item.description)item.description=next;item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render()},done:'Updated name to '+next};pendingExpiresAt=Date.now()+120000;return answer('Ye change karna hai? "'+(item.title||item.name||item.description)+'" → "'+next+'"? Haan / Nahi bolo.')}if(p.action==='complete'&&(s==='tasks'||s==='reminders')){const previous={done:item.done,completedAt:item.completedAt,updated:item.updated};item.done=true;item.completedAt=Date.now();item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render();return answer((s==='reminders'?'Reminder completed: ':'Completed ')+item.title+'.',s==='reminders'?'Reminders':'Tasks')}if((p.action==='pause'||p.action==='resume')&&s==='reminders'){const previous={paused:item.paused,updated:item.updated};item.paused=p.action==='pause';item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render();return answer((item.paused?'Paused reminder: ':'Resumed reminder: ')+item.title+'.','Reminders')}pending={apply:()=>{const before=arr().slice();data[collection]=arr().filter(x=>x.id!==item.id);persist();window.OneCommandsUndo=()=>{data[collection]=before;persist();render()};window.OneCommandsShowUndo?.();render()},done:'Deleted '+(item.title||item.name||item.description)};pendingExpiresAt=Date.now()+120000;return answer('Ye delete karna hai: "'+(item.title||item.name||item.description)+'"? Haan / Nahi bolo.')}
 return null;
 }
 function historyKey(){return 'one-ask-command-history-v1-'+(typeof workspaceStorageKey==='function'?workspaceStorageKey():'guest')}function history(){try{return JSON.parse(localStorage.getItem(historyKey())||'[]').slice(0,20)}catch{return []}}function remember(q){const value=String(q||'').trim();if(!value)return;try{localStorage.setItem(historyKey(),JSON.stringify([value,...history().filter(x=>x!==value)].slice(0,20)))}catch{}}window.OneCommands={KEYWORDS,detectIntent,parseCommand,executeCommand,hasPending:()=>!!pending,hasPendingReminder:()=>!!pendingReminderDraft,history,remember};
})();