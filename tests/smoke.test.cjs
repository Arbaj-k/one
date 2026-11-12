const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const documentFunction = fs.readFileSync('supabase/functions/document-json/index.ts', 'utf8');

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
assert.ok(source.includes('const expenses=asksMoney?'), 'Unrelated money records must not be sent to AI');
assert.ok(source.includes('const studySessions=asksRoutines?'), 'Unrelated routine records must not be sent to AI');

// Ask One actions must protect against accidental destructive actions and duplicate creation.
assert.ok(source.includes('let data=loadData(),page=\'overview\',chatBusy=false,pendingChatAction=null;'), 'Ask One confirmation state is missing');
assert.ok(source.includes('Please confirm: delete task'), 'Task deletion must require explicit confirmation');
assert.ok(source.includes('A matching open task already exists'), 'Task creation must detect duplicates');
assert.ok(source.includes('This exact note was already saved recently'), 'Note creation must detect recent duplicates');
assert.ok(source.includes('A project with this name already exists'), 'Project creation must detect duplicates');
assert.ok(source.includes('The action was cancelled. No data was changed.'), 'Action cancellation must be supported');

new vm.Script(source, { filename: 'app.js' });

// The static app shell must retain the containers required by app.js.
for (const id of ['page-content', 'modal-root', 'toast']) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing app shell id: ' + id);
}

// Core pages, data safety, document handling and CRUD routes.
for (const token of [
  'function render()', 'function aiAnswer(question)', 'function processUploadedDocuments',
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
