const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

// Parse check: catches syntax errors before a broken app reaches GitHub Pages.
new vm.Script(source, { filename: 'app.js' });

// Validate actual HTML IDs, not CSS-style selector text.
for (const id of ['page-content', 'modal-root', 'toast']) {
  assert.match(html, new RegExp(`\\bid=["']${id}["']`), `Missing app shell id: ${id}`);
}

// Core pages, persistence, uploads, restore, and rendering must remain present.
for (const token of [
  'function render()', 'function aiAnswer(q)', 'function processUploadedDocuments',
  'function persist()', 'function migrateData(raw)', 'function restoreData()',
  'function exportData()', 'function studyPlanner()', 'function projects()',
  'function expenses()', 'function saveForm(', 'function splitDocumentIntoChunks(text)',
  "'delete-document'", 'Unsupported file type. Upload a PDF or image.'
]) {
  assert.ok(source.includes(token), `Missing expected app feature: ${token}`);
}

// Every Money & Udhaar quick action must still have a source card and action route.
for (const kind of ['expense', 'lent', 'borrowed', 'all']) {
  assert.ok(source.includes(`'\${kind}'`) || source.includes(`"${kind}"`), `Missing quick-action kind: ${kind}`);
}
assert.match(source, /function expenseStat\\(/);
assert.match(source, /data-action="expense-quick-action"/);
assert.match(source, /'expense-quick-action':\\(\\)=>/);
assert.match(source, /name="kind"/);
assert.match(source, /name="description"/);
assert.match(source, /name="person"/);

// CRUD routes and local data recovery must remain wired.
for (const action of [
  'new-note', 'edit-note', 'delete-note', 'new-task', 'edit-task',
  'delete-task', 'new-project', 'edit-project', 'new-expense',
  'edit-expense', 'delete-expense', 'new-study', 'delete-study',
  'export-data', 'restore-data'
]) assert.ok(source.includes(action), `Missing workflow action: ${action}`);

assert.match(source, /localStorage\\.setItem\\(KEY,JSON\\.stringify\\(data\\)\\)/);
assert.match(source, /localStorage\\.getItem\\(KEY\\)/);
console.log('Student Brain smoke checks passed: syntax, app shell, core features, persistence, and Money & Udhaar quick actions.');
