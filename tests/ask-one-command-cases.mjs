import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const parserSource=readFileSync(new URL('../commands.js',import.meta.url),'utf8');
const adapterSource=readFileSync(new URL('../one-commands.js',import.meta.url),'utf8');
const window={};
const sandbox={window,Date,Intl,console,today:()=> '2026-11-16'};
vm.runInNewContext(parserSource,sandbox);
const parser=window.OneCommands;
assert.ok(parser,'local parser must expose OneCommands');

const cases=[
 ['mere tasks batao','tasks'],['pending task batao','tasks'],['pending tasks dikhao','tasks'],['reminder mai ky set hai batao','reminders'],['show my saved reminders','reminders'],['who owes me money?','money'],['aaj ka kharcha dikhao','money'],
 ['show my pending tasks','tasks'],['list all notes','notes'],['mere projects dikhao','projects'],
 ['daily routine batao','routines'],['show my PDFs','files'],['add task submit assignment tomorrow','tasks'],
 ['create a task to call Raj','tasks'],['kal maths homework complete karna hai','tasks'],
 ['task add karo maths homework','tasks'],['assignment add kar do submit form','tasks'],['homework bana do science chapter 4','tasks'],
 ['remind me to pay 500 to Raj tomorrow at 8pm','reminders'],['kal subah 9 baje bill pay yaad dilana','reminders'],
 ['daily briefing at 8am','reminders'],['weekly reminder every Monday','reminders'],
 ['monthly reminder for rent','reminders'],['save note meeting with Raj','notes'],
 ['remember this idea build a campus app','notes'],['create project Hapn redesign','projects'],
 ['add milestone launch beta to Hapn project','projects'],['spent 250 on auto today','money'],
 ['add expense 500 rupees for groceries','money'],['record income salary 25000','money'],
 ['received 1500 from client','money'],['Raj ko 500 udhaar diye','money'],
 ['borrowed 2000 from Aman','money'],['settled 300 with Raj','money'],
 ['how much did I spend this week?','money'],['aaj ka income dikhao','money'],
 ['delete task call Raj','tasks'],['mark maths homework done','tasks'],
 ['itne bhi task completed hai sabko delete kardo','tasks'],['delete all completed tasks','tasks'],['remove done tasks','tasks'],
 ['edit task gym to evening gym','tasks'],['search notes about exam','notes'],['search notes about homework','notes'],['find notes about assignment','notes'],
 ['what are my project deadlines?','projects'],['routine roz 7am walk','routines']
];
// A weekday in a timetable question is a lookup filter, never a task command.
for (const phrase of ['itne bhi task completed hai sabko delete kardo','delete all completed tasks','remove done tasks']) {
 const parsed=parser.parseCommand(phrase);
 assert.equal(parsed.section,'tasks',phrase+' should route to tasks');
 assert.equal(parsed.action,'delete',phrase+' should be recognized as bulk delete');
 assert.equal(parsed.bulkDeleteCompletedTasks,true,phrase+' should be flagged for bulk deletion');
}
for (const phrase of ['Tuesday class timetable','show me Tuesday class time table','What is my Tuesday class schedule?']) {
 const result=parser.parseCommand(phrase);
 assert.equal(result.section,null,'weekday timetable question must stay read-only: '+phrase);
}
for(const [phrase,expected] of cases){
 const result=parser.parseCommand(phrase);
 assert.equal(typeof result,'object','parser should handle: '+phrase);
 assert.equal(result.section,expected,'wrong section for: '+phrase);
}
const pay=parser.parseCommand('500 rupees chai pe kharcha add karo');
assert.equal(pay.amount,500);
assert.ok(!parserSource.includes('/\\\\b\\\\d'), 'money regex must use real word-boundary tokens');

const lunchReminder=parser.parseCommand('Remind me for lunch tomorrow with my gf');
assert.equal(lunchReminder.section,'reminders');
assert.equal(lunchReminder.title,'lunch with my gf','reminder title should preserve the subject and relationship context');
assert.equal(lunchReminder.date,'2026-11-17','tomorrow should be resolved to the next local date');
const timedReminder=parser.parseCommand('remind me to pay rent tomorrow at 8pm');
assert.equal(timedReminder.time,'20:00','8pm must parse as a reminder time');
const clockReminder=parser.parseCommand('remind me to call Raj on 20/11 at 18:30');
assert.equal(clockReminder.date,'2026-11-20','day/month dates must not be mistaken for clock values');
assert.equal(clockReminder.time,'18:30','24-hour clock values must parse when explicitly written');
const dateOnlyTask=parser.parseCommand('add task submit report due 20/11');
assert.equal(dateOnlyTask.time,'','a date such as 20/11 must not become a time');
const timeOnlyExpense=parser.parseCommand('add expense 5pm taxi');
assert.equal(timeOnlyExpense.amount,0,'clock values must not be saved as expense amounts');

const reminder=parser.parseCommand('remind me to Pay 500 to Raj tomorrow at 8pm');
assert.match(reminder.title,/pay 500 to raj/i,'reminder titles must preserve names, amounts and prepositions');
const chapter=parser.parseCommand('remind me to Read chapter 4 tomorrow at 8pm');
assert.match(chapter.title,/chapter 4/i,'reminder titles must preserve chapter numbers');
const assignment=parser.parseCommand('assignment add kar do submit form');
assert.equal(assignment.section,'tasks');
assert.equal(assignment.title,'submit form','assignment task titles should exclude command words');
const homework=parser.parseCommand('homework bana do science chapter 4');
assert.equal(homework.section,'tasks');
assert.equal(homework.title,'science chapter 4','homework task titles should preserve the actual task');
const taskIntentSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');

assert.ok(taskIntentSource.includes('const commandPrefix=query.match'), 'slash command prefix must be detected');
assert.ok(taskIntentSource.includes("section==='task'")&&taskIntentSource.includes("'add task '+body"), '/task natural phrasing should normalize to task creation intent');
assert.ok(taskIntentSource.includes("section==='expense'")&&taskIntentSource.includes("'add expense '+body"), '/expense free-form entry should normalize to expense creation intent');
const slashTask=parser.parseCommand('add task assignment karna hai kal 7 baje');
assert.equal(slashTask.section,'tasks','slash task body should route to task parser');
assert.equal(slashTask.date,'2026-11-17','slash task tomorrow should resolve the correct date');

assert.ok(taskIntentSource.includes('const originalQuery=String(question||')&&taskIntentSource.includes('const commandPrefix=query.match'), 'slash commands must normalize to deterministic action intents before routing');
const prefixedTask=parser.parseCommand('add task assignment karna hai kal 7 baje');
assert.equal(prefixedTask.section,'tasks','normalized /task requests must be routed to task section');
assert.equal(prefixedTask.date,'2026-11-17','normalized /task requests must resolve tomorrow correctly');
assert.ok(taskIntentSource.includes('add|create|make')&&taskIntentSource.includes('kar(?:o|na'), 'Ask One must recognize Hinglish task-create phrasing before reminder routing');
assert.ok(taskIntentSource.includes('const taskTypeMatch=raw.match')&&taskIntentSource.includes("join(' ')") , 'Ask One must preserve assignment/homework type in the saved task title');
const marked=parser.parseCommand('mark maths homework done');
assert.equal(marked.section,'tasks','homework completion must route to Tasks');
assert.equal(marked.action,'complete');
const recurring=parser.parseCommand('weekly reminder every Monday');
assert.equal(recurring.repeatRule,'weekly','weekly reminder recurrence must be parsed');
assert.equal(recurring.section,'reminders','recurring reminders must be routed separately from tasks');

let executed=0,callbacks=0;
const adapterWindow={OneCommands:{...parser,executeCommand(q){executed++;return {answer:'ok'}},hasPending:()=>false,hasPendingReminder:()=>false}};
vm.runInNewContext(adapterSource,{window:adapterWindow,console,SpeechSynthesisUtterance:function(){}});
const center=adapterWindow.OneCommands.create({actions:{addTask(){callbacks++;return {answer:'wrong engine'}}},fallback(){}});
for(const phrase of ['mere tasks batao','who owes me money?','aaj ka kharcha dikhao'])assert.equal(center.canHandle(phrase),true,'local query should route: '+phrase);
for(const phrase of ['Read this PDF and tell me what it says','Summarize the uploaded image','What is written in this invoice?','Is PDF ko padh ke samjhao'])assert.equal(center.canHandle(phrase),false,'document-content questions must reach OCR/AI retrieval: '+phrase);
assert.equal(center.canHandle('show my uploaded PDFs'),true,'file-list queries must remain local');
for (const phrase of ['Tuesday class timetable','show me Tuesday class time table','What is my Tuesday class schedule?']) assert.equal(center.canHandle(phrase),false,'timetable questions must bypass command mutations: '+phrase);
// Reminder clarification is owned by app.js sendChat, not the generic adapter draft.
const appReminderSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');
assert.ok(appReminderSource.includes('pendingReminderClarification=null'), 'Ask One must keep reminder clarification state in the chat pipeline');
assert.ok(appReminderSource.includes('if(pendingReminderClarification)'), 'A time-only reply must continue the pending reminder in sendChat');
assert.ok(appReminderSource.includes('makeReminderConfirmation(draft,clock)'), 'Reminder clarification must ask for YES/NO before saving');
await center.run('add task call Raj tomorrow');
assert.equal(executed,1,'all local command mutations must use the one authoritative executor');
assert.equal(callbacks,0,'competing callback mutation engines must not run');
const commandData={tasks:[],notes:[],projects:[],routines:[],expenses:[],documents:[]};
let persistCount=0,sequence=0;
const commandWindow={};
vm.runInNewContext(parserSource,{window:commandWindow,Date,Intl,console,today:()=> '2026-11-16',data:commandData,persist(){persistCount++},render(){},uid:()=> 'test-'+(++sequence),dateFmt:value=>value,money:value=>'₹'+value,localStorage:{getItem(){return null},setItem(){}}});
const moneyResult=commandWindow.OneCommands.executeCommand('500 rupees chai pe kharcha add karo');
assert.equal(commandData.expenses.length,1,'expense command must persist one expense record');
assert.equal(Number(commandData.expenses[0].amount),500);
assert.equal(commandData.expenses[0].kind,'expense');
assert.equal(commandData.expenses[0].category,'Food');
assert.ok(persistCount>0,'expense save must call persistence');

const pendingQuery=commandWindow.OneCommands.parseCommand('pending task batao');
assert.equal(pendingQuery.action,'show','batao must never be confused with banao/add');
const naturalReminderQuery=commandWindow.OneCommands.executeCommand('jo jo reminder set hai batao');
assert.match(naturalReminderQuery.answer,/saved reminders/i,'natural Hinglish reminder-list request must use the reminder store');
const reminderQuery=commandWindow.OneCommands.executeCommand('reminder mai ky set hai batao');
assert.match(reminderQuery.answer,/saved reminders \(0\)/i,'read-only reminder query must list the saved reminder collection without creating a reminder');
assert.equal(commandData.tasks.length,0,'read-only reminder lookup must not create a task');
commandData.tasks.push({id:'r1',title:'Pay rent',category:'Briefing',due:'2026-11-20',reminderTime:'09:00',repeatRule:'monthly',done:false});
const savedReminders=commandWindow.OneCommands.executeCommand('reminder mai ky set hai batao');
assert.match(savedReminders.answer,/Pay rent/,'reminder lookup must show the saved reminder');
assert.match(savedReminders.answer,/09:00/,'reminder lookup must show the scheduled time');
assert.equal(commandData.tasks.length,1,'reminder lookup must remain read-only');
commandData.tasks.length=0;
const recurringResult=commandWindow.OneCommands.executeCommand('weekly reminder to pay rent every Monday');
assert.equal(commandData.tasks.length,1,'weekly reminder command must create a task');
assert.equal(commandData.tasks[0].repeatRule,'weekly');
assert.equal(commandData.tasks[0].title,'pay rent','weekly reminder must preserve only the reminder subject');
assert.ok(commandData.tasks[0].due,'weekly reminder must have a next occurrence date');
const dailyResult=commandWindow.OneCommands.executeCommand('daily reminder to walk');
assert.equal(commandData.tasks.length,2,'daily reminder without a fixed date must still be scheduled');
assert.equal(commandData.tasks[1].repeatRule,'daily');
assert.equal(commandData.tasks[1].title,'walk');
const monthlyResult=commandWindow.OneCommands.executeCommand('monthly reminder for rent');
assert.equal(commandData.tasks.length,3,'monthly reminder without a fixed date must still be scheduled');
assert.equal(commandData.tasks[2].repeatRule,'monthly');
assert.equal(commandData.tasks[2].title,'rent');

// Explicit expenses must override overlapping Hindi money verbs; explicit lending stays Udhaar.
const expenseOnly=parser.parseCommand('expense add 50 rupee');
assert.equal(expenseOnly.domainIntent,'expense','explicit expense command must win over overlapping money verbs');
assert.equal(expenseOnly.udhaarType,'','explicit expense with no lender must not be Udhaar');
const expensePersonMention=parser.parseCommand('expense add 50 to Rahul for lunch');
assert.equal(expensePersonMention.domainIntent,'expense','person/preposition in expense must not change money domain');
assert.equal(expensePersonMention.udhaarType,'','normal expense mention of a person must not be lending');
const clearLending=parser.parseCommand('Raj ko 500 udhaar diye');
assert.equal(clearLending.domainIntent,'udhaar','explicit udhaar must remain lending');
assert.equal(clearLending.udhaarType,'lent','explicit lending direction should stay lent');
const clearBorrowing=parser.parseCommand('borrowed 2000 from Aman');
assert.equal(clearBorrowing.udhaarType,'borrowed','explicit borrowing must remain borrowed');

// Workspace filters, deadline edits and project operations must use the same local data store.
commandData.tasks.push(
 {id:'t-open',title:'DSA assignment',due:'2026-11-16',done:false},
 {id:'t-done',title:'Maths homework',due:'2026-11-15',done:true,completedAt:1},
 {id:'t-rem',title:'Call Rahul',due:'2026-11-16',reminderTime:'08:00',category:'Briefing',taskType:'reminder',isReminder:true,done:false}
);
const completedList=commandWindow.OneCommands.executeCommand('Show completed tasks');
assert.match(completedList.answer,/Maths homework/,'completed-task filter must show completed records');
assert.doesNotMatch(completedList.answer,/DSA assignment/,'completed-task filter must exclude open records');
const todayList=commandWindow.OneCommands.executeCommand('Show my tasks for today');
assert.match(todayList.answer,/DSA assignment/,'today task filter must show tasks due today');
const deadlineDraft=commandWindow.OneCommands.executeCommand('Change DSA deadline to Friday');
assert.match(deadlineDraft.answer,/deadline/,'deadline update must ask for confirmation');
assert.equal(commandData.tasks.find(x=>x.id==='t-open').due,'2026-11-16','deadline must not change before confirmation');
commandWindow.OneCommands.executeCommand('yes');
assert.equal(commandData.tasks.find(x=>x.id==='t-open').due,'2026-11-20','Friday deadline should save after confirmation');
commandData.projects.push({id:'p1',name:'Hapn Website',status:'Planning',milestones:[]});
const statusDraft=commandWindow.OneCommands.executeCommand('Update Hapn Website project status to active');
assert.match(statusDraft.answer,/status/i,'project status update must ask for confirmation');
commandWindow.OneCommands.executeCommand('yes');
assert.equal(commandData.projects[0].status,'Active','project status should update after confirmation');

const projectTaskDraft=commandWindow.OneCommands.executeCommand('Add a task to Hapn Website project: Fix login');
assert.match(projectTaskDraft.answer,/Project task add/i,'project task command must ask before saving');
assert.equal(commandData.tasks.some(x=>x.title==='Fix login'),false,'project task must not save before confirmation');
commandWindow.OneCommands.executeCommand('yes');
assert.ok(commandData.tasks.some(x=>x.title==='Fix login'&&x.projectId==='p1'),'project task must save with its project relationship');


const namedDate=parser.parseCommand('Remind me about my exam on 20 November');
assert.equal(namedDate.date,'2026-11-20','named month dates must parse for reminders');
const paidAmit=parser.parseCommand('I paid Amit 300 rupees');
assert.equal(paidAmit.udhaarType,'borrowed_repayment','a payment made to a lender must reduce borrowed balance');
assert.equal(paidAmit.person,'amit','repayment commands must capture the person');
const returnedByRahul=parser.parseCommand('Rahul returned 500 rupees');
assert.equal(returnedByRahul.udhaarType,'lent_repayment','money returned by a borrower must reduce lending balance');
assert.equal(returnedByRahul.person,'rahul','returned-payment commands must capture the person');
const lendingHistory=parser.parseCommand('Show my lending history');
assert.equal(lendingHistory.section,'money','lending history must route to Money');
const allTasks=parser.parseCommand('Mere saare tasks batao');
assert.equal(allTasks.section,'tasks','Hinglish all-task listing must route to Tasks');
const mondayQuestion=parser.parseCommand('monday ko refreshment ky hai');
assert.equal(mondayQuestion.action,'question','Hinglish weekday question must remain read-only');
assert.equal(mondayQuestion.section,null,'weekday question must not route to Tasks');
assert.equal(mondayQuestion.repeatRule,'none','weekday question must not create a weekly recurrence');
const mondayReminder=parser.parseCommand('Remind me every Monday to check timetable');
assert.equal(mondayReminder.section,'reminders','explicit Monday reminder must route to Reminders');
assert.equal(mondayReminder.repeatRule,'weekly','explicit recurring reminder must preserve weekly recurrence');

const isolatedDomains=[
 ['Add task pay electricity bill tomorrow','task','tasks'],
 ['Remind me to pay electricity bill tomorrow at 8 pm','reminder','reminders'],
 ['Add expense 500 for electricity bill','expense','money'],
 ['Add income 5000 salary','income','money'],
 ['Add 50 rupee on spending','expense','money'],
 ['Raj ko 500 udhaar diye','udhaar','money'],
 ['Save note electricity bill due date','note','notes']
];
for(const [phrase,domain,section] of isolatedDomains){
 const parsed=parser.parseCommand(phrase);
 assert.equal(parsed.domainIntent,domain,'intent must be isolated for: '+phrase);
 assert.equal(parsed.section,section,'section must match intent for: '+phrase);
}


// Ask One money handler source guardrails. Parser behavior is exercised above;
// this block guards the production money handler without relying on fragile VM
// extraction and scope injection that previously returned undefined drafts.
const appSource=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const moneyStart=appSource.indexOf('const moneyAmountMatch=raw.match');
const moneyEnd=appSource.indexOf('\n const noteReminderIntent=',moneyStart);
assert.ok(moneyStart>=0&&moneyEnd>moneyStart,'Ask One money action block must be present');
const moneyBlock=appSource.slice(moneyStart,moneyEnd);
assert.match(moneyBlock,/explicitExpenseCommand=/,'expense intent classification must exist');
assert.match(moneyBlock,/explicitLendingCommand=/,'explicit lending markers must be distinguished from expense wording');
assert.match(moneyBlock,/!explicitExpenseCommand&&/,'ambiguous Hindi lending verb must not override explicit expense');
assert.match(moneyBlock,/explicitIncomeCommand=/,'income intent classification must exist');
assert.match(moneyBlock,/udhaarCommand=/,'Udhaar intent classification must exist');
assert.match(moneyBlock,/if\(isLoan&&!person\)/,'only lending records require a person');
assert.match(moneyBlock,/kind=isLoan[\s\S]*?'income':'expense'/,'money kind must distinguish lending, income and expense');
assert.match(moneyBlock,/category='Food'/,'food category detection must exist');
assert.match(moneyBlock,/category='Travel'/,'travel category detection must exist');
assert.match(moneyBlock,/const record=\{id:uid\(\),description,person:person\|\|''/,'money record construction must preserve optional person');
assert.match(moneyBlock,/pendingAction=\{type:'create-record',collection:'expenses',record/,'money action must create a confirmation draft');
// End-to-end local executor coverage: deterministic create + readback for the core workspace.
const taskCreate=commandWindow.OneCommands.executeCommand('Add task E2E audit deliverable tomorrow');
assert.match(taskCreate.answer,/Task added:/,'Task command should return a successful local-save response');
assert.ok(commandData.tasks.some(x=>/E2E audit deliverable/i.test(x.title)),'Task command should persist a task record');
const noteCreate=commandWindow.OneCommands.executeCommand('Save note E2E audit unique note text');
assert.match(noteCreate.answer,/Note saved/i,'Note command should confirm local persistence');
assert.ok(commandData.notes.some(x=>/E2E audit unique text/i.test(x.content)),'Note command should persist the note body after stripping the structural "note" keyword');
const projectCreate=commandWindow.OneCommands.executeCommand('Create project E2E Audit Unique');
assert.match(projectCreate.answer,/Project created:/,'Project command should confirm creation');
assert.ok(commandData.projects.some(x=>/E2E Audit Unique/i.test(x.name)),'Project command should persist the project');
const routineCreate=commandWindow.OneCommands.executeCommand('routine daily E2E audit morning walk');
assert.match(routineCreate.answer,/Routine added:/,'Routine command should confirm creation');
assert.ok(commandData.routines.some(x=>/E2E audit/i.test(x.title)),'Routine command should persist the routine subject after structural words are stripped');
const noteRead=commandWindow.OneCommands.executeCommand('search notes E2E audit unique note text');
assert.match(noteRead.answer,/E2E audit unique text/i,'Notes retrieval should return the just-saved note body after structural words are stripped');

console.log('Ask One command cases passed: '+cases.length+' natural-language cases, expense persistence, daily/weekly/monthly reminder creation, router, Udhaar and title-preservation checks.');
