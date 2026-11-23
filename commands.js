/* Offline-first Ask One command parser. No network/API dependencies. */
(() => {
 const KEYWORDS={
  action:{add:['add','jodo','daalo','dalo','banao','create','likho','save','remember','note karo','lagao','set','remind','reminder','yaad dilao','yaad dilana'],show:['dikhao','batao','show','list','kya hai','kitna','kitni','kitne','search','dhundo','find','open','kholo'],edit:['badlo','change','update','edit','rename'],delete:['delete','hatao','mita do','remove'],complete:['complete','done','mark','finished','ho gaya','khatam','finish'],pause:['pause','paused','rok do','band karo'],resume:['resume','unpause','restart','chalu karo','phir se chalao']},
  section:{tasks:['task','tasks','todo','to do','kaam'],reminders:['reminder','reminders','remind','yaad dilao','yaad dilana','briefing'],notes:['note','notes','memo','idea','likha'],projects:['project','projects','milestone','progress'],routines:['routine','routines','habit','daily','roz','subah','raat'],money:['spending','lending','borrowing','paisa','paise','kharcha','kharch','expense','expenses','income','budget','balance','spent','salary','udhaar','money','received','credited','earned','paid','lent','lending','borrowed','borrowing','repayment','settle','settled','return','returned','paid back','lent','borrowed','received','paid'],files:['file','files','pdf','photo','image','document','bill','receipt'],scan:['scan','scanner']}
 };
 const norm=s=>String(s||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}\s₹./:-]/gu,' ').replace(/\s+/g,' ').trim();
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
 function parseDate(text){
  const q=norm(text),d=new Date(today()+'T12:00:00');
  if(/\b(aaj|today)\b/.test(q))return today();
  if(/\b(day after tomorrow|parso|parson)\b/.test(q))d.setDate(d.getDate()+2);
  else if(/\b(kal|tomorrow)\b/.test(q))d.setDate(d.getDate()+1);
  else{
   const months={january:0,jan:0,february:1,feb:1,march:2,mar:2,april:3,apr:3,may:4,june:5,jun:5,july:6,jul:6,august:7,aug:7,september:8,sep:8,october:9,oct:9,november:10,nov:10,december:11,dec:11};
   const named=q.match(/\b(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)(?:\s+(\d{4}))?\b/i)
    ||q.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
   if(named){
    const firstIsDay=/^\d+$/.test(named[1]),day=Number(firstIsDay?named[1]:named[2]),month=months[String(firstIsDay?named[2]:named[1]).toLowerCase()],year=Number(named[3]||today().slice(0,4)),x=new Date(year,month,day,12);
    if(x.getDate()===day&&x.getMonth()===month)return x.getFullYear()+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
   }
   const m=q.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
   if(m){let y=m[3]?Number(m[3]):Number(today().slice(0,4));if(y<100)y+=2000;const x=new Date(y,+m[2]-1,+m[1],12);if(x.getDate()===+m[1]&&x.getMonth()===+m[2]-1)return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')}
   const days={somvar:1,monday:1,mangalvar:2,tuesday:2,budhvar:3,wednesday:3,guruwar:4,thursday:4,shukravar:5,friday:5,shanivar:6,saturday:6,ravivar:0,sunday:0};
   const day=Object.keys(days).find(k=>q.includes(k));
   if(!day)return '';
   let delta=(days[day]-d.getDay()+7)%7;if(!delta||q.includes('agle'))delta=delta||7;d.setDate(d.getDate()+delta);
  }
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 }

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
  if(/\b(chai|tea|coffee|breakfast|lunch|dinner|food|restaurant|grocery|groceries|pizza|snack|biryani|khana|khaye|nashta|sabzi|doodh)\b/.test(q)||/खाना|खाये|बिरयानी/.test(q))return 'Food';
  if(/\b(petrol|diesel|fuel|uber|ola|taxi|cab|bus|train|metro|flight|travel|hotel|trip|auto|rickshaw)\b/.test(q))return 'Travel';
  if(/\b(rent|electricity|bijli|water|internet|mobile bill|recharge)\b/.test(q))return 'Bills';
  if(/\b(clothes|shopping|mall|amazon|flipkart|purchase|bought|shoes|shirt|gift)\b/.test(q))return 'Shopping';
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
  const q=norm(query);
  // A Hinglish question containing "ky/kya ... hai" is not a command,
  // even when it contains a weekday that could otherwise trigger recurrence.
  const conversationalQuestion=/\b(?:ky|kya|kaisa|kaisi|kaise|kaunsa|kaunsi)\b/i.test(q)&&/\b(?:hai|hain|hoga|hogi|batao|dikhao)\b/i.test(q);
  const explicitCommand=/^\s*(?:(?:please|kindly)\s+)?(?:add|create|make|save|record|log|schedule|set|remind|delete|remove|complete|finish|mark|update|change|pause|resume|task\s+add|todo\s+add)\b/i.test(q);
  if(conversationalQuestion&&!explicitCommand&&!/\b(?:batao|dikhao|show|list|display|saved|scheduled)\b/i.test(q))return {action:'question',section:null,domainIntent:null,ambiguous:false,matched:[],amount:parseAmount(query),date:null,time:null,title:'',projectName:'',query,summary:null,udhaarType:'',person:'',bulkDeleteCompletedTasks:false,repeatRule:'none',repeatDay:null};
  const reminderCue=/\b(?:remind(?:er)?|yaad\s+(?:dila|dilana|dila do|dila dena|rakhna)|set\s+(?:a\s+)?reminder|reminder\s+(?:set|laga)|briefing)\b/i.test(q);
  const bulkDeleteCompletedTasks=/\b(?:delete|remove|hatao|hata\s+do|mita\s+do|clear|saaf\s+(?:karo|kar\s+do))\b/i.test(q)&&/\b(?:completed|complete|done|finished|ho\s+gaye|ho\s+chuke)\b/i.test(q)&&/\b(?:tasks?|kaam)\b/i.test(q);
  const recurrence=parseRecurrence(q);
  const workTaskAdd=/\b(?:assignment|assignments|homework|exam|exams)\b/i.test(q)&&/\b(?:add|create|make|banao|bana|jodo|daalo|dalo|set|likho|save)\b/i.test(q);
  const taskManagementCue=/\b(?:mark|complete|finish|done|delete|remove|edit|update)\b/i.test(q)&&/\b(?:assignment|assignments|homework|exam|exams)\b/i.test(q);
  const taskListCue=/\b(?:tasks?|todo|to do|kaam)\b/i.test(q)&&/\b(?:show|list|display|tell|batao|dikhao|pending|completed|complete|done|all|saare|saari|sabhi|mere|my|find|search|today|aaj|overdue)\b/i.test(q);
  const explicitTaskCue=workTaskAdd||taskManagementCue||taskListCue||/\b(?:add|create|make|delete|remove|complete|finish|mark|update|change)\b.*\b(?:task|todo|assignment|homework|exam)\b/i.test(q);
  const explicitNoteCue=/\b(?:note|notes|memo)\b/i.test(q)||/^(?:remember|yaad rakhna)\b/i.test(q)||/\b(?:what did i write|what did i save|maine .{1,70} kya save|maine .{1,70} kya likha|save this idea|remember that|note karo|likh kar rakho)\b/i.test(q);
  const noteReadQuestion=/\b(?:what did i|what have i|what do i remember|maine .{1,90} kya (?:save|likh|note)|what did i save)\b/i.test(q);
  const explicitUdhaarCue=/\b(?:udhaar|lent|lend|gave|given|borrowed|borrow|repaid|repayment|settle|settled|paid back|returned|return|wapas|diye|diya|liya|liye)\b/i.test(q);
  const explicitIncomeCue=/\b(?:income|salary|earned|earning|received|credited|kamai|mila|mili)\b/i.test(q);
  const explicitExpenseCue=/\b(?:expense|expenses|kharcha|kharch|spent|spending|purchase|bought)\b/i.test(q);
  const personPaymentCue=/(?:^|[^a-z0-9])paid\s+[\p{L}][\p{L}\p{M}'-]*\s+\d/iu.test(q)&&!explicitExpenseCue;
  const domainIntent=reminderCue?'reminder':explicitTaskCue?'task':explicitNoteCue?'note':explicitExpenseCue?'expense':explicitIncomeCue?'income':(explicitUdhaarCue||personPaymentCue)?'udhaar':null;
  const explicitSection=domainIntent==='reminder'?'reminders':domainIntent==='task'?'tasks':domainIntent==='note'?'notes':['udhaar','income','expense'].includes(domainIntent)?'money':null;
  const det=bulkDeleteCompletedTasks?{intent:'tasks',ambiguous:false,matched:['tasks']}:explicitSection?{intent:explicitSection,ambiguous:false,matched:[explicitSection]}:detectIntent(q);
  const planSummary=/\b(aaj ka plan|today'?s plan|plan for today|aaj kya karna hai)\b/i.test(q);
  const weeklySpending=/\b(is hafte|iss hafte|this week|weekly)\b/i.test(q)&&/\b(kitna|kitni|kharcha|kharch|spent|spending|expenses?)\b/i.test(q);
  const dailySpending=/\b(aaj|today)\b/i.test(q)&&/\b(kharcha|kharch|spent|spending|expense|expenses)\b/i.test(q);
  const monthlySpending=/\b(?:this month|this month's|is month|iss month|isse month|is mahine|iss mahine|monthly|mahine ka|mahine ki)\b/i.test(q)&&/\b(?:kitna|kitni|kharcha|kharch|spent|spending|expense|expenses|total)\b/i.test(q);
  const completeOverview=/\b(?:complete overview|full overview|my overview|mera overview|meri summary|dashboard summary)\b/i.test(q);
  const categoryMatch=q.match(/\b(?:on|for|category)\s+(food|travel|shopping|bills|other|health)\b/i);
  const categorySpending=!!categoryMatch&&/\b(?:how much|kitna|kitni|spent|spend|kharcha|kharch|total)\b/i.test(q);
  const udhaarSummary=/\b(who owes me|who do i owe|how much do i owe|mere paise kis ke paas|kis se paise lene|kisko paise dene|udhaar summary)\b/i.test(q);
  const explicitRecurringCommand=reminderCue||/\b(?:daily|every day|roz|roj|har roz|har din|weekly|every week|har hafte|monthly|every month|each month|har mahine|mahine me ek baar|mahine mein ek baar)\b/i.test(q)||/\b(?:add|create|make|save|schedule|set)\b.{0,30}\b(?:task|todo|reminder|routine|habit)\b/i.test(q);
// A weekday alone is a lookup filter, not a task or reminder.
if(!det.intent&&recurrence.repeatRule!=='none'&&explicitRecurringCommand)det.intent=/\b(routine|habit|walk|exercise|meditation)\b/i.test(q)?'routines':'tasks';
  if(planSummary)det.intent='tasks';
  const readVerb=noteReadQuestion||/\b(?:show|list|display|tell|batao|dikhao|sunao|what|which|when|where|how|kitna|kitne|kitni|kya\s+(?:set|saved|scheduled|hai))\b/i.test(q);
  const amount=parseAmount(query);
  const expenseWrite=/\b(?:spent|spend|kharch(?:a|e)?\s+(?:kiya|kiye|hua|hue)|kharch\s+kar(?:a|e)?|paid\s+for|bought)\b/i.test(q)&&amount>0;
  const writeVerb=/\b(?:add|create|make|save|record|log|schedule|set|lagao|laga|banao|bana|jodo|daalo|dalo|yaad\s+dila)\b/i.test(q)||expenseWrite;
  let action=bulkDeleteCompletedTasks?'delete':readVerb?'show':writeVerb?'add':reminderCue?'add':Object.entries(KEYWORDS.action).find(([,ws])=>ws.some(w=>fuzzy(q,w)))?.[0]||'show';
  const explicitLoanCue=/\b(?:udhaar|lent|lend|gave|given|borrowed|borrow|repaid|repayment|settle|settled|paid back|returned|return|liya|liye|wapas)\b/i.test(q);
  const udhaarType=personPaymentCue?'borrowed_repayment':explicitLoanCue?( /\b(?:borrowed|borrow|liya|liye|udhaar liya)\b/i.test(q)?'borrowed':/\b(?:repaid|repayment|settle|settled|paid back|returned|return|wapas)\b/i.test(q)?(/\b(?:borrowed|liya)\b/i.test(q)?'borrowed_repayment':'lent_repayment'):'lent'):'';
  const person=(q.match(/(?:^|[^a-z0-9])to\s+([\p{L}][\p{L}\p{M}'-]*)/iu)||q.match(/(?:^|[^\p{L}\p{N}])([\p{L}][\p{L}\p{M}'-]*)\s+ko(?:$|[^\p{L}\p{N}])/iu)||q.match(/(?:^|[^a-z0-9])from\s+([\p{L}][\p{L}\p{M}'-]*)/iu)||q.match(/(?:^|[^a-z0-9])with\s+([\p{L}][\p{L}\p{M}'-]*)/iu)||q.match(/(?:^|[^a-z0-9])(?:lent|borrowed|paid|returned)\s+([\p{L}][\p{L}\p{M}'-]*)/iu)||q.match(/^\s*([\p{L}][\p{L}\p{M}'-]*)\s+(?:ne|has|have)\s+\d[\d,.]*\s+(?:rupees?|rupaye|rupay|rs)?\s*(?:wapas|return|returned|paid|bhej)/iu)||q.match(/^\s*([\p{L}][\p{L}\p{M}'-]*)\s+returned(?:$|[^\p{L}\p{N}])/iu)||[])[1]||'';
  if((/\b(salary|income|received|credited|kamai|mila|mili|expense|kharcha|kharch|spent|paid\s+for|bought)\b/.test(q)||udhaarType)&&amount)action='add';
  if(det.intent==='routines'&&/\b(routine|habit|daily|roz|roj|subah|raat|walk)\b/.test(q)&&!/\b(show|list|dikhao|batao|kitna|kya hai)\b/.test(q))action='add';
  if(recurrence.repeatRule!=='none'&&explicitRecurringCommand&&!readVerb)action='add';
  if(action==='complete'&&!det.intent)det.intent='tasks';
  if(action==='delete'&&!det.intent)det.intent='tasks';
  if(/\b(kitna|kitni|kitne|kya hai|how much|what is)\b/.test(q))action='show';
  // A spend/add command may mention "aaj" and "spending/expense"; do not
  // downgrade that write into the daily-spending read-only summary.
  if((planSummary||weeklySpending||dailySpending||monthlySpending||completeOverview||udhaarSummary||categorySpending)&&!writeVerb)action='summary';
  const date=parseDate(query),time=parseTime(query);
  let title=q
   .replace(/\b(?:please|kindly|add|jodo|daalo|dalo|banao|bana|create|likho|save|task|tasks|todo|assignment|assignments|homework|exam|exams|reminder|remind|yaad|dila|dilana|briefing|note|notes|project|routine|habit|paisa|paise|money|kharcha|kharch|expense|expenses|income|salary|set|schedule|kar do|karo|karna|mujhe|me|for|mere liye|mark|complete|finish|done|delete|remove|edit|update|do)\b/gi,' ')
   .replace(/\b(?:today|aaj|tomorrow|kal|parso|parson|daily|every day|weekly|monthly|every week|every month|roz|roj|har roz|har din|subah|morning|evening|shaam|sham|raat|night|at|baje|am|pm|oclock)\b/gi,' ')
   .replace(/\b(?:due|on)\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gi,' ')
   .replace(/\b(?:on|due)\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gi,' ')
   .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)\b/gi,' ')
   .replace(/\s+/g,' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g,'').trim();
  const projectName=(q.match(/\bproject\s+([\p{L}\p{N}_-]+)/u)||[])[1]||'';
  if(det.intent==='projects'&&/\bmilestone\b/.test(q))title='New milestone';
  const summary=planSummary?'today-plan':weeklySpending?'week-spending':dailySpending?'today-spending':monthlySpending?'month-spending':completeOverview?'complete-overview':udhaarSummary?'udhaar-summary':categorySpending?'category-spending':null;
  return {action,section:det.intent,domainIntent:domainIntent||({tasks:'task',reminders:'reminder',notes:'note',money:udhaarType?'udhaar':'money'}[det.intent]||det.intent),ambiguous:det.ambiguous,matched:det.matched,amount,date,time,title,projectName,query,summary,udhaarType,person,bulkDeleteCompletedTasks,...recurrence};
 }

 let pending=null, pendingReminderDraft=null, pendingExpiresAt=0, reminderDraftExpiresAt=0;
 function answer(text,source){return {answer:text,sources:[source||'Ask One']}}
 function executeCommand(query){const q=norm(query);if(pending&&Date.now()>pendingExpiresAt){pending=null;pendingExpiresAt=0;}if(pending&&!/^(?:haan|ha|yes|y|ok|okay|theek hai|theek|kar do|confirm|proceed|nahi|na|no|n|cancel|rehne do|mat karo|stop|\d+)$/i.test(q)){pending=null;pendingExpiresAt=0;}if(pending){const p=pending;if(p.choose){const n=Number(q);if(!Number.isInteger(n)||n<1||n>p.choose.length)return answer('List me se number reply karo, jaise 1 ya 2.');const item=p.choose[n-1];pending=null;if(p.action==='delete'){pending={apply:()=>{data[p.collection]=data[p.collection].filter(x=>x.id!==item.id);persist();render()},done:'Deleted '+(item.title||item.name||item.description)};return answer('Ye delete karna hai: "'+(item.title||item.name||item.description)+'"? Haan / Nahi bolo.')}if(p.action==='complete'&&p.collection==='tasks'){pending={apply:()=>{item.done=true;item.completedAt=Date.now();persist();render()},done:'Completed '+item.title};return answer('Mark "'+item.title+'" complete? Haan / Nahi bolo.')}return answer(item.title||item.name||item.description||'Selected item')}pending=null;if(/^(haan|ha|yes|y|ok|okay|theek hai|theek|confirm|kar do|proceed)$/.test(q)){p.apply();return answer(p.done,'Ask One')}if(/^(nahi|na|no|n|cancel|rehne do|mat karo|stop)$/.test(q))return answer('Cancelled. Koi change nahi kiya.');pending=p;return answer('Pending action ke liye Haan ya Nahi bolo.')}
 if(/\b(?:delete|remove|hatao|hata\s+do|mita\s+do|clear|saaf\s+(?:karo|kar\s+do))\b/i.test(q)&&/\b(?:completed|complete|done|finished|ho\s+gaye|ho\s+chuke)\b/i.test(q)&&/\b(?:tasks?|kaam)\b/i.test(q)){
  const isCompleted=item=>!!item&&(item.done===true||item.completed===true||String(item.status||'').toLowerCase()==='completed');
  const completed=(data.tasks||[]).filter(isCompleted);
  if(!completed.length)return answer('Koi completed task nahi mila. Koi change nahi kiya.','Tasks');
  const before=(data.tasks||[]).slice(),count=completed.length;
  pending={apply:()=>{data.tasks=(data.tasks||[]).filter(item=>!isCompleted(item));persist();window.OneCommandsUndo=()=>{data.tasks=before;persist();render()};window.OneCommandsShowUndo?.();render()},done:count+' completed task'+(count===1?'':'s')+' deleted'};
  pendingExpiresAt=Date.now()+120000;
  return answer(count+' completed task'+(count===1?'':'s')+' mile. Kya sabhi delete kar doon? Reply YES to confirm or NO to cancel. Abhi kuch delete nahi hua.','Tasks');
 }
 if(pendingReminderDraft&&/^(?:cancel|no|nahi|rehne do|mat karo|stop)$/i.test(q)){pendingReminderDraft=null;reminderDraftExpiresAt=0;return answer('Reminder draft cancelled. Koi reminder save nahi hua.','Task Briefing')}
 const reminderLookup=(/\b(?:reminders?|remind|briefings?)\b/i.test(q)||/\byaad\s+(?:dilane|dilane wale|dilana)\b/i.test(q))&&(/\b(?:show|list|tell|what|which|when|batao|dikhao|kya|kaun|sab|saare|saari|jo|saved|scheduled|hai|hain)\b/i.test(q)||/\bjo\s+jo\b/i.test(q));
 if(reminderLookup){
  const rows=(data.tasks||[]).filter(item=>item&&(item.category==='Briefing'||item.isReminder===true||item.taskType==='reminder'||item.source==='reminder'));
  const all=rows.filter(item=>(!q.includes('today')&&!q.includes('aaj'))||String(item.due||'')===today()).slice().sort((a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999'))||String(a.reminderTime||'').localeCompare(String(b.reminderTime||'')));
  const list=all.length?all.map((item,index)=>{
   const status=item.done||item.completed?'Completed':item.paused?'Paused':'Active';
   return (index+1)+'. '+(item.title||'Untitled reminder')+' · '+(item.due?dateFmt(item.due):'Date not set')+' at '+(item.reminderTime||'09:00')+((item.repeatRule&&item.repeatRule!=='none')?' · '+item.repeatRule:'')+' · '+status;
  }).join('\\n'):'Aapke workspace mein abhi koi saved reminder nahi mila. Tasks aur reminders alag rakhe gaye hain.';
  return answer('Aapke saved reminders ('+all.length+'):\\n'+list,'Reminders');
 }
 const reminderCue=/\b(?:remind(?:er)?|yaad\s+(?:dila|dilana|dila do|dila dena|rakhna)|set\s+(?:a\s+)?reminder|reminder\s+(?:set|laga)|briefing)\b/i.test(q);
 if(pendingReminderDraft&&Date.now()>reminderDraftExpiresAt)pendingReminderDraft=null;if(pendingReminderDraft&&/^(?:add|create|make|show|list|delete|remove|complete|mark|save|note|task|expense|income|udhaar|project|routine)\b/i.test(q)){pendingReminderDraft=null;}if((reminderCue&&!/\b(?:delete|remove|pause|resume|stop|cancel)\b/i.test(q))||pendingReminderDraft){
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
 const p=parseCommand(query),s=p.section;

 // Deterministic, account-local workspace commands. Keep these ahead of generic AI routing.
 const taskRows=()=>Array.isArray(data.tasks)?data.tasks:[];
 const isReminderRow=x=>!!(x&&(x.isReminder===true||x.taskType==='reminder'||x.category==='Briefing'));
 const isDoneRow=x=>!!(x&&(x.done===true||x.completed===true||String(x.status||'').toLowerCase()==='completed'));
 const taskNameFrom=(raw,verbs)=>String(raw||'').replace(verbs,'').replace(/\b(?:task|tasks|todo|assignment|homework|exam|deadline|due date|to|as|the|my|please|kindly)\b/gi,' ').replace(/\b(?:today|aaj|tomorrow|kal|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/gi,' ').replace(/\s+/g,' ').trim();
 if(/\b(?:change|update|set|move)\b/i.test(q)&&/\b(?:deadline|due date|due)\b/i.test(q)){
  const due=parseDate(query);if(!due)return answer('Nayi deadline samajh nahi aayi. Example: Change DSA deadline to Friday.','Tasks');
  const name=taskNameFrom(q,/^.*?\b(?:change|update|set|move)\b/i),tokens=name.split(' ').filter(t=>t.length>2&&!['deadline','due','date'].includes(t));
  const matches=taskRows().filter(x=>!isReminderRow(x)&&tokens.some(t=>norm(x.title).includes(t)));
  if(matches.length!==1)return answer(matches.length?'Ek se zyada tasks match hue. Exact task title bhejo.':'Matching task nahi mila. Koi change nahi kiya.','Tasks');
  const item=matches[0],old=item.due||'';pending={apply:()=>{item.due=due;item.updated=Date.now();persist();render()},done:'Deadline updated: '+item.title+' · '+dateFmt(due)};pendingExpiresAt=Date.now()+120000;
  return answer('Task “'+item.title+'” ki deadline '+(old?dateFmt(old):'unset')+' se '+dateFmt(due)+' kar doon? YES / NO.','Tasks');
 }
 const projectStatus=q.match(/\b(?:update|change|set)\s+(.+?)\s+project\s+status\s+to\s+(active|paused|completed|complete|done|on hold|planning)\b/i);
 if(projectStatus){
  const key=norm(projectStatus[1]),matches=(data.projects||[]).filter(x=>norm(x.name||x.title).includes(key)||key.includes(norm(x.name||x.title)));
  if(matches.length!==1)return answer(matches.length?'Multiple projects match. Exact project name bhejo.':'Project nahi mila. Koi change nahi kiya.','Projects');
  const item=matches[0],next=/^(complete|done)$/i.test(projectStatus[2])?'Completed':projectStatus[2].replace(/^./,c=>c.toUpperCase()),old=item.status||'Not set';
  pending={apply:()=>{item.status=next;item.updated=Date.now();persist();render()},done:'Project status updated: '+(item.name||item.title)+' · '+next};pendingExpiresAt=Date.now()+120000;
  return answer('“'+(item.name||item.title)+'” ka status '+old+' se '+next+' kar doon? YES / NO.','Projects');
 }
 const projectTask=String(query||'').match(/\badd\s+(?:a\s+)?task\s+to\s+(.+?)\s+project\s*[:,-]?\s*(.+)$/i);
 if(projectTask){
  const key=norm(projectTask[1]),project=(data.projects||[]).find(x=>norm(x.name||x.title)===key||norm(x.name||x.title).includes(key));
  if(!project)return answer('Project “'+projectTask[1]+'” nahi mila. Pehle project create karo.','Projects');
  const title=projectTask[2].trim(),due=parseDate(query),record={id:uid(),title,projectId:project.id,projectName:project.name||project.title,category:'Project',due,priority:'Medium',done:false,created:Date.now(),updated:Date.now(),notes:'Linked to '+(project.name||project.title)};
  pending={apply:()=>{data.tasks.push(record);persist();render()},done:'Task added to '+(project.name||project.title)+': '+title};pendingExpiresAt=Date.now()+120000;
  return answer('Project task add kar doon? “'+title+'” → '+(project.name||project.title)+'. YES / NO. Abhi save nahi hua.','Projects');
 }
 // Dedicated note rename/delete and expense edit/delete workflows.
 const confirmMutation=(item,apply,done,source)=>{
  pending={apply,done};pendingExpiresAt=Date.now()+120000;
  return answer('Confirm: '+done+'? Reply YES to confirm or NO to cancel. Abhi koi change nahi hua.',source);
 };
 const findByText=(items,target,fields)=>{
  const needle=norm(target).replace(/^(?:my|the|about|note|notes|expense|expenses)\s+/,'').trim();
  if(!needle)return [];
  const tokens=needle.split(' ').filter(t=>t.length>1);
  return items.map(item=>({item,score:tokens.reduce((n,t)=>n+(fields(item).some(v=>norm(v).includes(t))?1:0),0)}))
   .filter(x=>x.score>0).sort((a,b)=>b.score-a.score)
   .filter((x,i,a)=>x.score===a[0].score).map(x=>x.item);
 };
 const noteDelete=q.match(/^(?:please\s+)?(?:delete|remove|hatao|mita\s+do)\s+(?:my\s+)?notes?\s+(.+)$/i);
 const noteRename=q.match(/^(?:please\s+)?(?:rename|edit|update|change)\s+(?:my\s+)?note\s+(.+?)\s+(?:to|as|naam\s+se)\s+(.+)$/i);
 if((noteDelete||noteRename)&&s==='notes'){
  const target=(noteDelete||noteRename)[1].replace(/^["']|["']$/g,'').trim();
  const matches=findByText(data.notes||[],target,x=>[x.title,x.content,x.subject,x.tags]);
  if(matches.length!==1)return answer(matches.length?'Multiple notes match. Note ka exact title ya kuch unique words bhejo.':'Matching note nahi mila. Koi change nahi kiya.','Notes');
  const item=matches[0];
  if(noteDelete){
   const before=(data.notes||[]).slice();
   return confirmMutation(item,()=>{data.notes=(data.notes||[]).filter(x=>x.id!==item.id);persist();window.OneCommandsUndo=()=>{data.notes=before;persist();render()};window.OneCommandsShowUndo?.();render()},'Delete note "'+(item.title||'Untitled note')+'"','Notes');
  }
  const next=(noteRename[2]||'').replace(/^["']|["']$/g,'').trim();
  if(!next)return answer('Naya note title batao. Example: rename note Shopping to Grocery list.','Notes');
  const previous={title:item.title,updated:item.updated};
  return confirmMutation(item,()=>{item.title=next;item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render()},'Rename note "'+(item.title||'Untitled note')+'" to "'+next+'"','Notes');
 }
 const expenseDelete=q.match(/^(?:please\s+)?(?:delete|remove|hatao|mita\s+do)\s+(?:my\s+)?(?:the\s+)?expenses?\s+(.+)$/i);
 const expenseEdit=q.match(/^(?:please\s+)?(?:edit|update|change)\s+(?:my\s+)?(?:the\s+)?expense\s+(.+?)\s+(?:to|as)\s+(.+)$/i);
 if((expenseDelete||expenseEdit)&&s==='money'){
  const target=(expenseDelete||expenseEdit)[1].replace(/^["']|["']$/g,'').trim();
  const matches=findByText(data.expenses||[],target,x=>[x.description,x.category,x.person,x.kind,x.tags,x.date]);
  if(matches.length!==1)return answer(matches.length?'Multiple expense records match. Date ya exact description bhi batao.':'Matching expense nahi mila. Koi change nahi kiya.','Money');
  const item=matches[0];
  if(expenseDelete){
   const before=(data.expenses||[]).slice();
   return confirmMutation(item,()=>{data.expenses=(data.expenses||[]).filter(x=>x.id!==item.id);persist();window.OneCommandsUndo=()=>{data.expenses=before;persist();render()};window.OneCommandsShowUndo?.();render()},'Delete expense "'+(item.description||item.category||'Expense')+'" · '+money(item.amount),'Money');
  }
  const replacement=(expenseEdit[2]||'').trim(),amountMatch=replacement.match(/(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(?:rupees?|rs\.?))?/i);
  const nextAmount=amountMatch?Number(amountMatch[1].replace(/,/g,'')):null;
  const nextDescription=replacement.replace(/^(?:₹|rs\.?\s*)?\d[\d,]*(?:\.\d+)?\s*(?:rupees?|rs\.?)?\s*/i,'').trim();
  if(nextAmount===null&&!nextDescription)return answer('Nayi amount ya description batao. Example: edit expense dinner to 80 rupees.','Money');
  const previous={amount:item.amount,description:item.description,category:item.category,tags:item.tags,updated:item.updated};
  const summary=(nextAmount!==null?'amount '+money(item.amount)+' → '+money(nextAmount):'description "'+item.description+'" → "'+nextDescription+'"');
  return confirmMutation(item,()=>{if(nextAmount!==null)item.amount=nextAmount;if(nextDescription){item.description=nextDescription;item.category=autoExpenseCategory(nextDescription);item.tags=[String(item.category||'Other').toLowerCase()]};item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render()},'Update expense "'+(item.description||'Expense')+'" ('+summary+')','Money');
 }
 if(!s)return null;
 const collection={tasks:'tasks',reminders:'tasks',notes:'notes',projects:'projects',routines:'routines',money:'expenses',files:'documents'}[s],arr=()=>Array.isArray(data[collection])?data[collection]:[];
 const terms=norm(p.title||query).split(' ').filter(t=>t.length>2&&!Object.values(KEYWORDS.section).flat().map(norm).includes(t)&&!['dikhao','batao','show','list','saare','saari','sabhi','sab','jo','mere','mera','meri','history','lending','borrowing','november','december','january','february','march','april','may','june','july','august','september','october','pending','completed','complete','finished','done','incomplete','open','overdue','late','today','aaj','tomorrow','kal','for','my','delete','money','income','expense','expenses','kharcha','routine','tasks','task','notes','note','wala','wali','wale','please','mere','mera','meri','my','all','aaj','today','who','owes','me','ka','ki','ke','mai','mein','meine','maine','jo','hai','tha','thi','the','kya','what','did','save','saved','likha','likhi','kiya','baare','bare','about','related','please','tell','write','wrote','mujhe','mera','meri','mere'].includes(t));
 const statusCompleted=/\b(?:completed|complete|done|finished)\b/i.test(q),statusPending=/\b(?:pending|incomplete|open|baaki)\b/i.test(q),statusToday=/\b(?:today|aaj)\b/i.test(q),statusOverdue=/\b(?:overdue|late)\b/i.test(q),monthMatch=q.match(/\b(?:this month|this month's|is month|iss month|isse month|is mahine|iss mahine|november|december|january|february|march|april|may|june|july|august|september|october)\b/i);
 const rows=arr().filter(x=>s==='reminders'?isReminderRow(x):s==='tasks'?!isReminderRow(x):true).filter(x=>s==='tasks'&&statusCompleted?isDoneRow(x):s==='tasks'&&statusPending?!isDoneRow(x):s==='tasks'&&statusToday?String(x.due||'')===today():s==='tasks'&&statusOverdue?!isDoneRow(x)&&!!x.due&&x.due<today():s==='reminders'&&statusToday?String(x.due||'')===today():s==='money'&&q.includes('lending')?['lent','lent_repayment'].includes(x.kind):s==='money'&&q.includes('borrowing')?['borrowed','borrowed_repayment'].includes(x.kind):true).filter(x=>s!=='money'||!monthMatch||String(x.date||'').slice(0,7)===today().slice(0,7)).map(x=>{const hay=norm([x.title,x.name,x.description,x.content,x.note,x.tags,x.subject,x.category,x.person,x.kind,x.amount,x.date].flat().join(' '));return {x,score:terms.reduce((n,t)=>n+(hay.split(' ').includes(t)?2:hay.includes(t)?1:0),0)}}).filter(x=>!terms.length||x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.x);
 if(p.action==='add'){
  if(s==='scan'){const picker=document.createElement('input');picker.type='file';picker.accept='image/*';picker.capture='environment';picker.onchange=()=>{const file=picker.files?.[0];if(file)openFileMetadataDialog(file)};picker.click();return answer('Camera scan khul gaya. Document ki photo lo, phir save karo.','Scan')}if(s==='files'){openUploadForm();return answer('File picker khul gaya. PDF ya photo choose karo.','Uploaded Items')}
  if(s==='tasks'||s==='reminders'){if(!p.title)return answer(s==='reminders'?'Reminder kis baat ka set karna hai?':'Task ka naam batao.');const repeat=p.repeatRule||'none',due=p.date||(repeat!=='none'?today():''),isReminder=s==='reminders';const r={id:uid(),title:p.title,due,reminderTime:isReminder?(p.time||'09:00'):(p.time||''),priority:'Medium',category:isReminder?'Briefing':'Task',taskType:isReminder?'reminder':'task',isReminder,repeatRule:repeat,repeatDay:p.repeatDay,done:false,created:Date.now(),updated:Date.now()};data.tasks.push(r);persist();window.OneCommandsUndo=()=>{data.tasks=data.tasks.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer((isReminder?'Reminder set: ':'Task added: ')+r.title+(r.due?' · '+dateFmt(r.due):'')+(isReminder?' · '+r.reminderTime:'')+(repeat!=='none'?' · Repeats '+repeat:''),isReminder?'Reminders':'Tasks')}
  if(s==='notes'){if(!p.title)return answer('Note ka content batao.');const r={id:uid(),title:'Quick note',content:p.title,subject:'Quick capture',tags:'ask one',created:Date.now(),updated:Date.now()};data.notes.unshift(r);persist();window.OneCommandsUndo=()=>{data.notes=data.notes.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();render();return answer('Note saved.','Notes')}
  if(s==='money'){if(!p.amount)return answer('Amount batao. Example: 500 rupaye chai pe kharcha jodo.');if(p.udhaarType){if(!p.person)return answer('Kis person ke saath udhaar hai? Example: Raj ko 500 udhaar diye.');const r={id:uid(),amount:p.amount,kind:p.udhaarType,person:p.person,description:(p.udhaarType.includes('repayment')?'Udhaar repayment':p.udhaarType==='borrowed'?'Borrowed':'Lent')+' · '+p.person,date:p.date||today(),created:Date.now(),updated:Date.now()};data.expenses.push(r);persist();window.OneCommandsUndo=()=>{data.expenses=data.expenses.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();window.moneyTab='udhaar';render();return answer('Udhaar saved: '+money(r.amount)+' · '+r.kind+' · '+r.person,'Money & Udhaar')}const income=/\b(income|salary|aayi|aaya|received|credited)\b/.test(q),r={id:uid(),amount:p.amount,kind:income?'income':'expense',description:(income?'Salary':q.replace(/\b(?:aaj|today|tomorrow|kal|parso|on|at|rupees?|rupaye|rupay|rs\.?|spent|spend|kharcha|kharch|kiya|kiye|hua|hue|par|pe|for|expense|add|save|record|log|track)\b/gi,' ').replace(/\b\d[\d,]*(?:\.\d+)?\b/g,' ').replace(/\s+/g,' ').trim()||'Expense'),category:income?'Salary':autoExpenseCategory(q),tags:income?['income','salary']: [autoExpenseCategory(q).toLowerCase(),...(/chai|tea|coffee/.test(q)?['chai']:[])],date:p.date||today(),created:Date.now(),updated:Date.now()};data.expenses.push(r);persist();window.OneCommandsUndo=()=>{data.expenses=data.expenses.filter(x=>x.id!==r.id);persist();render()};window.OneCommandsShowUndo?.();window.moneyTab=income?'income':'spending';render();return answer((income?'Income':'Expense')+' saved: '+money(r.amount)+' · '+r.description,'Money')}
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
  const spent=entries.filter(x=>(x.kind||'expense')==='expense').reduce((n,x)=>n+Number(x.amount||0),0);
  const income=entries.filter(x=>x.kind==='income').reduce((n,x)=>n+Number(x.amount||0),0);
  const categories={};entries.filter(x=>(x.kind||'expense')==='expense').forEach(x=>{const k=x.category||'Other';categories[k]=(categories[k]||0)+Number(x.amount||0)});
  const breakdown=Object.entries(categories).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+': '+money(v)).join(' · ');
  return answer('Is hafte ka kharcha ('+dateFmt(from)+' – '+dateFmt(to)+'): '+money(spent)+'. Income: '+money(income)+(breakdown?'. Categories: '+breakdown:''),'Money summary');
 }
 if(p.action==='summary'&&p.summary==='category-spending'){
  const category=String((q.match(/\b(?:on|for|category)\s+(food|travel|shopping|bills|other|health)\b/i)||[])[1]||'').toLowerCase();
  const entries=(data.expenses||[]).filter(x=>(x.kind||'expense')==='expense'&&String(x.category||'Other').toLowerCase()===category),total=entries.reduce((n,x)=>n+Number(x.amount||0),0);
  return answer('Aapka '+(category||'selected category')+' spending total: '+money(total)+'\nRecords: '+entries.length,'Money summary');
 }
 if(p.action==='summary'&&p.summary==='month-spending'){
  const month=today().slice(0,7),entries=(data.expenses||[]).filter(x=>String(x.date||'').slice(0,7)===month),expenses=entries.filter(x=>(x.kind||'expense')==='expense'),total=expenses.reduce((n,x)=>n+Number(x.amount||0),0),categories={};
  expenses.forEach(x=>{const key=x.category||'Other';categories[key]=(categories[key]||0)+Number(x.amount||0)});
  const breakdown=Object.entries(categories).sort((a,b)=>b[1]-a[1]).map(([key,value])=>key+': '+money(value)).join(' · ');
  return answer('Is month ka total kharcha: '+money(total)+(breakdown?'\nCategory-wise: '+breakdown:'\nAbhi is month koi expense record nahi mila.'),'Money summary');
 }
 if(p.action==='summary'&&p.summary==='complete-overview'){
  const date=today(),pending=(data.tasks||[]).filter(x=>!x.done&&!x.completed&&!(x.isReminder||x.taskType==='reminder')),todayReminders=(data.tasks||[]).filter(x=>(x.isReminder||x.taskType==='reminder'||x.category==='Briefing')&&!x.done&&!x.paused&&String(x.due||'')===date),weekStart=new Date(date+'T12:00:00');weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));const from=weekStart.toISOString().slice(0,10),weekExpenses=(data.expenses||[]).filter(x=>(x.date||'')>=from&&(x.date||'')<=date&&(x.kind||'expense')==='expense'),spent=weekExpenses.reduce((n,x)=>n+Number(x.amount||0),0),activeProjects=(data.projects||[]).filter(x=>!['completed','complete','done'].includes(String(x.status||'').toLowerCase()));
  const lent={},borrowed={};(data.expenses||[]).forEach(x=>{const name=String(x.person||'').trim();if(!name)return;if(x.kind==='lent')lent[name]=(lent[name]||0)+Number(x.amount||0);if(x.kind==='lent_repayment')lent[name]=(lent[name]||0)-Number(x.amount||0);if(x.kind==='borrowed')borrowed[name]=(borrowed[name]||0)+Number(x.amount||0);if(x.kind==='borrowed_repayment')borrowed[name]=(borrowed[name]||0)-Number(x.amount||0)});
  const oweMe=Object.values(lent).reduce((n,v)=>n+Math.max(0,v),0),iOwe=Object.values(borrowed).reduce((n,v)=>n+Math.max(0,v),0);
  return answer('Your complete overview ✨\\nPending tasks: '+pending.length+'\\nToday reminders: '+todayReminders.length+'\\nThis week spending: '+money(spent)+'\\nPeople owe you: '+money(oweMe)+'\\nYou owe: '+money(iOwe)+'\\nActive projects: '+activeProjects.length,'One overview');
 }
 if(p.action==='summary'&&p.summary==='today-plan'){
  const date=today(),pending=(data.tasks||[]).filter(x=>!x.done&&x.due&&x.due<=date).sort((a,b)=>String(a.reminderTime||'99:99').localeCompare(String(b.reminderTime||'99:99')));
  const weekday=new Date(date+'T12:00:00').getDay();const routineRows=(data.routines||[]).filter(x=>x.frequency==='daily'||x.repeatRule==='daily'||(x.repeatRule==='weekly'&&Number(x.repeatDay)===weekday));
  const lines=[...pending.map(x=>(x.due<date?'Overdue':'Today')+' · '+(x.reminderTime||'No time')+' · '+x.title),...routineRows.map(x=>(x.time||'Routine')+' · '+x.title)];
  return answer('Aaj ka plan:\n'+(lines.length?lines.join('\n'):'Aaj koi scheduled task ya routine nahi hai.')+'\nPending tasks: '+(data.tasks||[]).filter(x=>!x.done).length,'Today plan');
 }
 if(p.action==='show'&&s==='tasks'&&(statusCompleted||statusPending||statusToday||statusOverdue)){return answer(rows.length?rows.map((x,i)=>(i+1)+'. '+x.title+(x.due?' · '+dateFmt(x.due):'')+(isDoneRow(x)?' · Completed':'')).join('\\n'):'Is filter mein koi task nahi mila.','Tasks')}
 if(p.action==='show'&&s==='reminders'&&statusToday){const a=rows.filter(x=>!x.done&&!x.paused);return answer(a.length?a.map((x,i)=>(i+1)+'. '+x.title+(x.due?' · '+dateFmt(x.due):'')+' · '+(x.reminderTime||'09:00')).join('\\n'):'Aaj koi reminder nahi hai.','Reminders')}
 if(p.action==='show'){if(s==='reminders'){const a=(data.tasks||[]).filter(x=>(x.isReminder===true||x.taskType==='reminder'||x.category==='Briefing')&&!x.done&&!x.paused);return answer(a.length?a.map((x,i)=>(i+1)+'. '+x.title+(x.due?' · '+dateFmt(x.due):'')+' · '+(x.reminderTime||'09:00')+(x.repeatRule&&x.repeatRule!=='none'?' · '+x.repeatRule:'')).join('\n'):'Abhi koi upcoming reminder nahi hai.','Reminders')}if(s==='tasks'&&/\b(pending|incomplete|open|baaki)\b/.test(q)){const a=data.tasks.filter(x=>!x.done&&!(x.isReminder===true||x.taskType==='reminder'||x.category==='Briefing'));return answer(a.length?a.map((x,i)=>(i+1)+'. '+x.title+(x.due?' · '+dateFmt(x.due):'')).join('\n'):'No pending tasks.','Tasks')}if(s==='money'&&monthMatch){const names={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12},named=String(monthMatch[0]||'').toLowerCase(),month=named==='this month'||named==='is month'||named==='monthly'?today().slice(0,7):today().slice(0,4)+'-'+String(names[named]||Number(today().slice(5,7))).padStart(2,'0'),a=data.expenses.filter(x=>(x.date||'').startsWith(month)),n=a.filter(x=>(x.kind||'expense')==='expense').reduce((v,x)=>v+Number(x.amount||0),0);return answer('Spending for '+month+': '+money(n)+(a.length?'\\n'+a.map(x=>(x.description||x.person||x.kind||'Record')+' · '+money(x.amount)).join('\\n'):''),'Money')}if(rows.length===1&&s==='files'){openUploadedFile(rows[0].id,false);return answer('Opening '+rows[0].name,'Uploaded Items')}if(rows.length)return answer(rows.slice(0,8).map((x,i)=>(i+1)+'. '+(s==='notes'?(x.title||'Note')+' · '+(x.content||x.description||''):(x.title||x.name||x.description||x.content||'Saved item'))).join('\n'),s);return answer('Mujhe iske baare mein kuch nahi mila. Aap Tasks, Notes, Projects, Routines, Money ya Files try kar sakte ho.')}
 if(s==='files'&&p.action==='delete')return answer('File delete karne ke liye Uploaded Items section use karo, taaki original file bhi safely remove ho.','Uploaded Items');
 if(['delete','edit','complete','pause','resume'].includes(p.action)){if(rows.length>1){pending={choose:rows,action:p.action,collection};pendingExpiresAt=Date.now()+120000;return answer('Kaunsa item? Number choose karo:\n'+rows.slice(0,5).map((x,i)=>(i+1)+') '+(x.title||x.name||x.description)).join('\n'))}if(!rows.length)return answer('Matching item nahi mila. Koi change nahi kiya.');const item=rows[0];if(p.action==='edit'){const m=q.match(/\b(?:to|as|naam)\s+(.+)$/);if(!m)return answer('Naya naam bhi likho. Example: rename gym task to evening gym.');const next=m[1].trim(),previous={title:item.title,name:item.name,description:item.description,updated:item.updated};pending={apply:()=>{if(item.title)item.title=next;else if(item.name)item.name=next;else if(item.description)item.description=next;item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render()},done:'Updated name to '+next};pendingExpiresAt=Date.now()+120000;return answer('Ye change karna hai? "'+(item.title||item.name||item.description)+'" → "'+next+'"? Haan / Nahi bolo.')}if(p.action==='complete'&&(s==='tasks'||s==='reminders')){const previous={done:item.done,completedAt:item.completedAt,updated:item.updated};item.done=true;item.completedAt=Date.now();item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render();return answer((s==='reminders'?'Reminder completed: ':'Completed ')+item.title+'.',s==='reminders'?'Reminders':'Tasks')}if((p.action==='pause'||p.action==='resume')&&s==='reminders'){const previous={paused:item.paused,updated:item.updated};item.paused=p.action==='pause';item.updated=Date.now();persist();window.OneCommandsUndo=()=>{Object.assign(item,previous);persist();render()};window.OneCommandsShowUndo?.();render();return answer((item.paused?'Paused reminder: ':'Resumed reminder: ')+item.title+'.','Reminders')}pending={apply:()=>{const before=arr().slice();data[collection]=arr().filter(x=>x.id!==item.id);persist();window.OneCommandsUndo=()=>{data[collection]=before;persist();render()};window.OneCommandsShowUndo?.();render()},done:'Deleted '+(item.title||item.name||item.description)};pendingExpiresAt=Date.now()+120000;return answer('Ye delete karna hai: "'+(item.title||item.name||item.description)+'"? Haan / Nahi bolo.')}
 return null;
 }
 function historyKey(){return 'one-ask-command-history-v1-'+(typeof workspaceStorageKey==='function'?workspaceStorageKey():'guest')}function history(){try{return JSON.parse(localStorage.getItem(historyKey())||'[]').slice(0,20)}catch{return []}}function remember(q){const value=String(q||'').trim();if(!value)return;try{localStorage.setItem(historyKey(),JSON.stringify([value,...history().filter(x=>x!==value)].slice(0,20)))}catch{}}window.OneCommands={KEYWORDS,detectIntent,parseCommand,executeCommand,hasPending:()=>!!pending,hasPendingReminder:()=>!!pendingReminderDraft,history,remember};
})();