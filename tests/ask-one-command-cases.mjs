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
 ['mere tasks batao','tasks'],['who owes me money?','money'],['aaj ka kharcha dikhao','money'],
 ['show my pending tasks','tasks'],['list all notes','notes'],['mere projects dikhao','projects'],
 ['daily routine batao','routines'],['show my PDFs','files'],['add task submit assignment tomorrow','tasks'],
 ['create a task to call Raj','tasks'],['kal maths homework complete karna hai','tasks'],
 ['remind me to pay 500 to Raj tomorrow at 8pm','tasks'],['kal subah 9 baje bill pay yaad dilana','tasks'],
 ['daily briefing at 8am','tasks'],['weekly reminder every Monday','tasks'],
 ['monthly reminder for rent','tasks'],['save note meeting with Raj','notes'],
 ['remember this idea build a campus app','notes'],['create project Hapn redesign','projects'],
 ['add milestone launch beta to Hapn project','projects'],['spent 250 on auto today','money'],
 ['add expense 500 rupees for groceries','money'],['record income salary 25000','money'],
 ['received 1500 from client','money'],['Raj ko 500 udhaar diye','money'],
 ['borrowed 2000 from Aman','money'],['settled 300 with Raj','money'],
 ['how much did I spend this week?','money'],['aaj ka income dikhao','money'],
 ['delete task call Raj','tasks'],['mark maths homework done','tasks'],
 ['edit task gym to evening gym','tasks'],['search notes about exam','notes'],
 ['what are my project deadlines?','projects'],['routine roz 7am walk','routines']
];
for(const [phrase,expected] of cases){
 const result=parser.parseCommand(phrase);
 assert.equal(typeof result,'object','parser should handle: '+phrase);
 assert.equal(result.section,expected,'wrong section for: '+phrase);
}
const pay=parser.parseCommand('500 rupees chai pe kharcha add karo');
assert.equal(pay.amount,500);
assert.ok(!/\/\\b\\d/.test(parserSource),'money regex must use real word-boundary tokens');
const reminder=parser.parseCommand('remind me to Pay 500 to Raj tomorrow at 8pm');
assert.match(reminder.title,/pay 500 to raj/i,'reminder titles must preserve names, amounts and prepositions');
const chapter=parser.parseCommand('remind me to Read chapter 4 tomorrow at 8pm');
assert.match(chapter.title,/chapter 4/i,'reminder titles must preserve chapter numbers');

let executed=0,callbacks=0;
const adapterWindow={OneCommands:{...parser,executeCommand(q){executed++;return {answer:'ok'}},hasPending:()=>false,hasPendingReminder:()=>false}};
vm.runInNewContext(adapterSource,{window:adapterWindow,console,SpeechSynthesisUtterance:function(){}});
const center=adapterWindow.OneCommands.create({actions:{addTask(){callbacks++;return {answer:'wrong engine'}}},fallback(){}});
for(const phrase of ['mere tasks batao','who owes me money?','aaj ka kharcha dikhao'])assert.equal(center.canHandle(phrase),true,'local query should route: '+phrase);
await center.run('add task call Raj tomorrow');
assert.equal(executed,1,'all local command mutations must use the one authoritative executor');
assert.equal(callbacks,0,'competing callback mutation engines must not run');
console.log('Ask One command cases passed: '+cases.length+' natural-language cases plus router, Udhaar and title-preservation checks.');
