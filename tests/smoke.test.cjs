const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const documentFunction = fs.readFileSync('supabase/functions/document-json/index.ts', 'utf8');
const documentExtractor = fs.readFileSync('document-extractor.js', 'utf8');

// Document JSON must accept a normal HTTP Bearer token (not a literal \\s sequence).
assert.match(documentFunction, /\.match\(\/\^Bearer\\s\+\(\.\+\)\$\/i\)/);
const bearerPattern = /^Bearer\s+(.+)$/i;
for (const header of ['Bearer test-token', 'bearer another-token']) {
  assert.ok(bearerPattern.exec(header)?.[1], 'Document JSON rejected a valid Bearer header');
}
assert.equal(bearerPattern.exec('Basic test-token'), null, 'Document JSON must reject non-Bearer authorization');


// Parse the application before checking that its key routes remain wired.
// Ask One should only send personal record categories that match the user's intent.
assert.ok(source.includes('const asksTasks=overviewIntent||'), 'Ask One task context must be intent-gated');
assert.ok(source.includes('const asksMoney=overviewIntent||'), 'Ask One money context must be intent-gated');
assert.ok(source.includes('function isDocumentContentQuestion(question)'), 'Document Q&A intent detection is missing');
assert.ok(source.includes('pdf|image|photo|document|file)\\s+(?:se|mein|me|ka|ki|ke|ko|par|about|from)'), 'Hindi/Hinglish document references must trigger document Q&A');
assert.ok(source.includes('return mentionsFile&&asksContent&&!isFileLookup;'), 'Document questions must route to document evidence, not the generic task/note router');
assert.ok(source.includes('const expenses=asksMoney?'), 'Unrelated money records must not be sent to AI');
assert.ok(source.includes('const studySessions=asksRoutines?'), 'Unrelated routine records must not be sent to AI');

// Universal retrieval must not fall back to unrelated records when a query has no match.
assert.ok(source.includes('else selectedTasks=matches.map(item=>item.task).slice(0,40);'), 'Task retrieval must return only matched records');
assert.ok(source.includes('selectedProjects=matches.map(item=>item.project).slice(0,15);'), 'Project retrieval must return only matched records');
assert.ok(source.includes('selectedMemories=ranked.map(item=>item.memory).slice(0,15);'), 'Memory retrieval must return only matched records');

// Ask One actions must protect against accidental destructive actions and duplicate creation.
const intentStart=source.indexOf('async function chatActionIntent(question)');
const intentEnd=source.indexOf('async function sendChat(question',intentStart);
const intentSource=source.slice(intentStart,intentEnd);
assert.ok(intentSource.indexOf('const verify=')<intentSource.indexOf('if(pendingChatAction)'), 'Action confirmation must initialize verification before use');
assert.ok(intentSource.includes("pending.type==='create-record'"), 'Create actions must use the shared confirmation handler');
assert.ok(intentSource.includes('5*60*1000'), 'Pending confirmations must expire instead of remaining valid indefinitely');
for (const message of ['Please confirm task:', 'Please confirm note:', 'Please confirm project:', 'Please confirm money record:', 'Please confirm this money record:']) assert.ok(intentSource.includes(message), 'Create confirmation missing: '+message);
assert.ok(source.includes('let data=loadData(),page=\'overview\',chatBusy=false,pendingChatAction=null;'), 'Ask One confirmation state is missing');
assert.ok(source.includes('Please confirm: delete task'), 'Task deletion must require explicit confirmation');
assert.ok(source.includes('A matching open task already exists'), 'Task creation must detect duplicates');
assert.ok(source.includes('This exact note was already saved recently'), 'Note creation must detect recent duplicates');
assert.ok(source.includes('A project with this name already exists'), 'Project creation must detect duplicates');
assert.ok(source.includes('The action was cancelled. No data was changed.'), 'Action cancellation must be supported');

// Ask One Phase 2: amount/date parsing, income/expense capture, record updates and cloud-sync messaging.
assert.ok(source.includes('async function chatActionIntent(question)'), 'Ask One actions must await cloud sync checks');
assert.ok(source.includes('const moneyCreateCue='), 'Natural-language money capture is missing');
assert.ok(source.includes("kind==='income'"), 'Income records must be supported');
assert.ok(source.includes('const fieldDateForMoney='), 'Money date parsing is missing');
assert.ok(source.includes('const relative=lower.match('), 'Relative date parsing is missing');
assert.ok(source.includes('type:\'update-record\''), 'Record updates must require confirmation');
assert.ok(source.includes('Please confirm update for '), 'Record update confirmation prompt is missing');
assert.ok(source.includes('Object.assign(record,pending.patch,{updated:Date.now()})'), 'Confirmed record updates must be applied');
assert.ok(source.includes('await syncQueue'), 'Action confirmation must wait for queued cloud sync');
assert.ok(source.includes('const actionResult=await chatActionIntent(query)'), 'Chat handler must await async actions');

// Phase 4 personal intelligence: explicit memory, workspace search,
// deadline-based planning, expense-only category comparisons and project risk checks.
for (const token of [
  'function phase4SearchWorkspace(question)',
  'function phase4DailyPlan()',
  'function phase4SpendingInsights()',
  'function phase4ProjectRisks()',
  'const rememberMatch=raw.match(',
  'Saved to Personal Memory:',
  'return phase4SearchWorkspace(raw)',
  'return phase4DailyPlan()',
  'return phase4SpendingInsights()',
  'return phase4ProjectRisks()',
  "const expenses=(data.expenses||[]).filter(e=>(e.kind||'expense')==='expense')",
  'overdue=open.filter(t=>t.due&&t.due<todayDate)',
  'This is a suggested order, not an automatic change to your tasks.',
  'spendingInsights:asksMoney?phase4SpendingInsights().answer:undefined'
]) {
  assert.ok(source.includes(token), 'Phase 4 intelligence feature missing: ' + token);
}
assert.ok(source.includes('data.memories.push(memory);persist();'), 'Explicit memory capture must use the existing workspace memory collection');
assert.ok(source.includes('const duplicate=data.memories.find(m=>String(m.content||\'\').trim().toLowerCase()===content.toLowerCase())'), 'Memory capture must prevent exact duplicates');
assert.ok(source.includes("previous=addDaysToDate(month+'-01',-1).slice(0,7)"), 'Spending comparison must use the preceding calendar month');
assert.ok(source.includes("item.extractedText,item.summary,JSON.stringify(item.extractedJson||{})"), 'Workspace search should include extracted document text, summaries and structured data');
assert.ok(source.includes("(data.expenses||[]).forEach(item=>add("), 'Workspace search should include money records');

// Document vault: page-aware OCR, multilingual extraction, reviewable expiry dates,
 // note connections and reminders. AI summaries are intentionally absent.
for (const token of [
 'function documentVault()',
 'function phase5SearchResults(query)',
 'function personalTimeline()',
 'function documentRelatedNotes(doc)',
 'function openVaultResult(id)',
 "'toggle-document-pin'",
 "'save-document-expiry'",
 "'connect-document-note'",
 "'open-vault-result'",
 "'document-expiry-'+doc.id+'-'+doc.expiresOn+'-'+todayDate",
 'function documentTextQuality(value)',
 'function shouldRunDocumentOCR(value)',
 "window.Tesseract.recognize(source,languages[index])",
 'function normalizeDocumentDigits(value)',
 'function oneExtractExpiryCandidates(text)',
 "'confirm-expiry-candidate'",
 'const pageLimit=Math.min(pdf.numPages,100)',
 'if(pdf.numPages>pageLimit)extracted+=',
 'ocrQuality:Math.round(documentTextQuality(usableText)*100)',
]) assert.ok(source.includes(token),'Document extraction feature missing: '+token);
assert.ok(documentFunction.includes('Hindi (Devanagari), or mixed Hindi-English/Hinglish'),'Structured extraction prompt must support Hindi and Hinglish');
assert.ok(documentFunction.includes('image/webp'),'Structured extraction must accept WEBP images');
assert.ok(documentExtractor.includes("type:'expiry'")&&documentExtractor.includes("type:'deadline'")&&documentExtractor.includes("type:'amount'"),'Structured extraction must classify expiry, deadline and amount fields');
assert.ok(documentExtractor.includes('facts,tables,timetable,line_records'),'Structured facts must be retained alongside tables and timetable data');
assert.ok(!source.includes('async function summarizeDocument(id)'), 'Automatic AI summary function should be removed');
assert.ok(!source.includes("'summarize-document':"), 'AI summary action should be removed');
assert.ok(source.includes("doc.expiryDateSource={line:candidate.line,page:candidate.page,confirmedAt:Date.now()}"),'Expiry reminder must retain the user-confirmed source evidence');
assert.ok(source.includes("doc.expiryReminderDays=[30,7,1,0]"),'Confirmed expiry dates must enable reminder thresholds');
assert.ok(source.includes('relatedNoteIds'),'Documents must persist related-note connections');
assert.ok(source.includes('data.documents||[]'),'Vault must use the existing account workspace documents collection');
assert.ok(css.includes('.vault-search-card')&&css.includes('.vault-timeline'),'Vault UI styles are missing');

// Phase 3 smart automation: weekly review, project progress, Udhaar due alerts and natural-language reminders.
assert.ok(source.includes('function smartWeekSummary()'), 'Weekly review summary is missing');
assert.ok(source.includes('function smartProjectProgress()'), 'Project progress intelligence is missing');
assert.ok(source.includes('function upcomingUdhaar()'), 'Upcoming Udhaar summary is missing');
assert.ok(!source.slice(source.indexOf('function overview(){'),source.indexOf('async function summarizeDocument')).includes('upcomingUdhaar()'), 'Home dashboard must keep repayment reminders out of its layout.');
assert.ok(source.includes('Daily briefing'), 'Today dashboard daily briefing is missing');
assert.ok(source.includes('const reminderIntent='), 'Natural-language reminders are missing');
assert.ok(source.includes("successMessage:(daily?'Daily briefing':'Reminder')+' saved: '"), 'Reminder save confirmation is missing.');
assert.ok(source.includes('reminderTime,notes,priority'), 'Task reminder time extraction is missing');
assert.ok(source.includes("const loanRows=(data.expenses||[]).filter(e=>['lent','borrowed'].includes(e.kind)"), 'Udhaar notification checks are missing');
assert.ok(source.includes("const key='loan-'+entry.id"), 'Udhaar notifications need per-record duplicate protection');
assert.ok(source.includes("'go-udhaar':()=>"), 'Dashboard Udhaar shortcut is missing');
assert.ok(source.includes("'go-money-reports':()=>"), 'Dashboard weekly report shortcut is missing');

new vm.Script(source, { filename: 'app.js' });

// Navigation is intentionally removed; every workspace route remains available to the app.
assert.ok(!html.includes('class="sidebar"'), 'The old sidebar navigation must be removed');
assert.ok(!html.includes('id="nav"'), 'The old navigation menu must be removed');
assert.ok(!html.includes('class="nav-item"'), 'Navigation menu items must not render in the app shell');
assert.ok(css.includes('.mobile-nav{display:none!important}'), 'Legacy mobile navigation styles must be explicitly disabled');

// The static app shell must retain the containers required by app.js.
for (const id of ['page-content', 'modal-root', 'toast']) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing app shell id: ' + id);
}

// Core pages, data safety, document handling and CRUD routes.
for (const token of [
  'function render()', 'function aiAnswer(question)', 'function processUploadedDocuments',
  'const structuredDocuments=rankedJson.map(({doc})=>',
  'item.score>0||isDocumentContentQuestion(question)',
  '(targetDocId||documentQuestion)&&!matching.length',
  'if(!doc.extractedJson?.structured_data)await convertDocumentToJSON(doc.id)',
  'function persist()', 'function migrateData(raw)', 'function restoreData()',
  'function exportData()', 'function studyPlanner()', 'function projects()',
  'function expenses()', 'function saveForm(', 'function splitDocumentIntoChunks(text)',
  "'delete-document'", 'Unsupported file type. Upload a PDF or image.',
  'const snapshot=JSON.stringify(data)',
  "localStorage.setItem(workspaceStorageKey(),snapshot)",
  "localStorage.setItem(workspaceStorageKey()+'-last-good',snapshot)",
  'saveWorkspaceSnapshot(data)',
  'localStorage.getItem(workspaceStorageKey())'
]) {
  assert.ok(source.includes(token), 'Missing expected app feature: ' + token);
}

// Money & Udhaar quick-action wiring.
for (const token of [
  "expenseStat('Spending this month'", "expenseStat('You are owed'",
  "expenseStat('You owe others'", 'Income this month',
  'data-action="expense-quick-action"', "'expense-quick-action':()=>",
  "openForm('expense')", 'typeField.value=id', "if(id==='all')",
  "field('Transaction type','kind'", "field('Person','person'", 'expense-quick-action'
]) {
  assert.ok(source.includes(token) || css.includes(token), 'Money & Udhaar quick-action wiring missing: ' + token);
}
assert.ok(css.includes('.expense-quick-action'), 'Money & Udhaar quick-action styles are missing');

// Run database security guardrails and the extended regression suite.
execFileSync(process.execPath, ['tests/cloud-schema-guardrails.cjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tests/regression-smoke.mjs'], { stdio: 'inherit' });

console.log('Student Brain smoke checks passed: syntax, app shell, core features, data safety, CRUD and quick actions.');
