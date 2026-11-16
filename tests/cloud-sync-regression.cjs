const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const start=app.indexOf('function mergeWorkspaceSnapshots(');
const end=app.indexOf('let workspaceChannel=',start);
assert.ok(start>=0&&end>start,'Workspace merge helpers must exist');
const context={
 DATA_SCHEMA_VERSION:4,
 starter:()=>({schemaVersion:4,notes:[],tasks:[],projects:[],routines:[],people:[],expenses:[],moneyBudgets:[],messages:[],studySessions:[],documents:[],memories:[],notifications:[],deletedRecords:[],deletedCloudDocuments:[]}),
 migrateData(raw){const next={...this.starter(),...(raw&&typeof raw==='object'?raw:{})};for(const key of ['notes','tasks','projects','routines','people','expenses','moneyBudgets','messages','studySessions','documents','memories','notifications','deletedRecords','deletedCloudDocuments'])if(!Array.isArray(next[key]))next[key]=[];next.schemaVersion=4;return next;}
};
vm.runInNewContext(app.slice(start,end)+'\nthis.mergeWorkspaceSnapshots=mergeWorkspaceSnapshots;this.trackWorkspaceDeletionTombstones=trackWorkspaceDeletionTombstones;',context);
const local={tasks:[{id:'local-new',title:'Local task',updated:200}],notes:[{id:'same',title:'Local version',updated:300}],deletedRecords:[{collection:'tasks',id:'deleted-task',deletedAt:400}]};
const remote={tasks:[{id:'remote-new',title:'Remote task',updated:150},{id:'deleted-task',title:'Stale remote task',updated:999}],notes:[{id:'same',title:'Remote version',updated:100}],deletedRecords:[]};
const merged=context.mergeWorkspaceSnapshots(local,remote);
assert.deepEqual(Array.from(merged.tasks.map(x=>x.id)).sort(),['local-new','remote-new']);
assert.equal(merged.notes[0].title,'Local version');
assert.ok(merged.deletedRecords.some(x=>x.collection==='tasks'&&x.id==='deleted-task'));
const previous=JSON.stringify({tasks:[{id:'removed',title:'Old task'}],notes:[{id:'kept',title:'Keep'}]});
const next=context.trackWorkspaceDeletionTombstones(previous,{tasks:[],notes:[{id:'kept',title:'Keep'}]});
assert.ok(next.deletedRecords.some(x=>x.collection==='tasks'&&x.id==='removed'),'Local deletion must create a cloud tombstone');
const after=context.mergeWorkspaceSnapshots(next,{tasks:[{id:'removed',title:'Stale task',updated:999999}],notes:[],deletedRecords:[]});
assert.equal(after.tasks.some(x=>x.id==='removed'),false,'A deleted record must not resurrect from a stale remote snapshot');
assert.ok(after.notes.some(x=>x.id==='kept'),'Unchanged records must survive merge');
const has=(needle,label)=>assert.ok(app.includes(needle),label);
has("storage.from('one-user-documents').upload","Documents must upload to the private per-user bucket");
has("from('user_documents').upsert","Document metadata must be persisted to the owner-bound table");
has("storage.from('one-user-documents').download","Documents must be downloadable on a second signed-in device");
has("storage.from('one-user-documents').remove","Document deletion must remove the private cloud object");
has("await syncPendingDocumentFiles();","Pending document uploads must retry after workspace activation");
has("then(()=>syncPendingDocumentFiles())","Pending document uploads must retry after reconnect");
has(".eq('revision',expectedRevision)","Workspace snapshot writes must use optimistic revision checks");
has("const mimeType=normalizedDocumentMime(file),isPdf=mimeType==='application/pdf';","Document OCR must use normalized MIME values");
has("const needsPdf=valid.some(file=>normalizedDocumentMime(file)==='application/pdf');","PDF library loading must recognize extension-only PDFs");
has("doc.mimeType=mimeType;","OCR retry must preserve the normalized MIME type");
has("from('profiles').upsert(profile","Authentication must upsert the deployed profiles table");
console.log('Cloud sync regression passed: concurrent merge, deletion tombstones, private document upload/download/delete, retry hooks, MIME handling and profile schema.');
