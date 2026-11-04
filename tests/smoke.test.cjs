const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

// Parse the application before checking that its key routes remain wired.
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
  "localStorage.setItem(KEY,snapshot)",
  "localStorage.setItem(KEY+'-last-good',snapshot)",
  'saveWorkspaceSnapshot(data)',
  'localStorage.getItem(KEY)'
]) {
  assert.ok(source.includes(token), 'Missing expected app feature: ' + token);
}

// Money & Udhaar quick-action wiring.
for (const token of [
  "expenseStat('Spending this month'", "expenseStat('You are owed'",
  "expenseStat('You owe others'", "expenseStat('Records'",
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
