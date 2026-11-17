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
assert.ok(appReminderSource.includes('let pendingAction=null,pendingReminderClarification=null'), 'Ask One must keep reminder clarification state in the chat pipeline');
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
assert.match(reminderQuery.answer,/active reminder saved nahi hai/i,'read-only reminder query must list, not create a reminder');
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
console.log('Ask One command cases passed: '+cases.length+' natural-language cases, expense persistence, daily/weekly/monthly reminder creation, router, Udhaar and title-preservation checks.');
