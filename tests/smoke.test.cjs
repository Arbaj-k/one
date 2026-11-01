const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('app.js', 'utf8');
// Parse check: catches syntax errors before a broken app reaches GitHub Pages.
new vm.Script(source, { filename: 'app.js' });

// Check important app entry points and page handlers exist in source.
for (const token of ['function render()', 'function aiAnswer(q)', 'function processUploadedDocuments', 'function persist()', "'delete-document'"]) {
  assert.ok(source.includes(token), `Missing expected app entry point: ${token}`);
}
console.log('Student Brain smoke checks passed: app.js parses and core entry points exist.');
