import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const voice = readFileSync(new URL('../voice-assistant.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Syntax validation catches startup-breaking parse errors.
execFileSync(process.execPath, ['--check', new URL('../app.js', import.meta.url).pathname]);
execFileSync(process.execPath, ['--check', new URL('../voice-assistant.js', import.meta.url).pathname]);
assert.ok(app.includes('window.submitStudentBrainVoiceText = function(raw)'), 'Global voice command handler is missing.');
assert.ok(voice.includes('window.submitStudentBrainVoiceText(phrase)'), 'Speech recognition is not routed to the global command handler.');
assert.ok(voice.includes('let submitted = false;'), 'Voice result must be processed only once per listening session.');
assert.ok(!app.includes('id="chat-file-upload"'), 'Ask My Brain should not show a file picker.');
assert.ok(!app.includes('id="chat-upload-status"'), 'Ask My Brain should not show an upload status row.');
assert.ok(app.includes('id="quick-add-file-upload"'), 'Quick Add file picker is missing.');
assert.ok(app.includes('data-action="quick-add-upload"'), 'Quick Add Upload file option is missing.');
assert.ok(app.includes("'quick-add-upload':()=>document.querySelector('#quick-add-file-upload')?.click()"), 'Quick Add upload action is not wired to the file picker.');
assert.ok(app.includes("if(e.target.id==='quick-add-file-upload')"), 'Quick Add file selection is not wired to document processing.');
assert.ok(app.includes("document.querySelector('#quick-add-upload-status')||document.querySelector('#document-upload-status')"), 'Quick Add upload progress is not reported.');
assert.ok(css.includes('.quick-add-upload-status'), 'Quick Add upload status styling is missing.');

assert.ok(voice.includes("if (event.results[i].isFinal) finalText += part + ' ';"), 'Final speech fragments are not accumulated into a complete command.');
assert.ok(voice.includes("const phrase = finalText.replace(/\\\\s+/g, ' ').trim();"), 'Voice command is not normalized after recognition ends.');
assert.ok(voice.indexOf('recognition.onend = () =>') < voice.indexOf('window.submitStudentBrainVoiceText(phrase)'), 'Voice command must be submitted after recognition has ended.');

assert.ok(app.includes("const taskCue=/"), 'Voice task intent matcher is missing.');
assert.ok(app.includes("data.tasks.push(task);"), 'Voice task handler does not save captured tasks.');

// Exercise the real voice task handler in isolation with lightweight browser stubs.
const voiceHandlerStart = app.indexOf('window.handleStudentBrainVoiceCommand = function(raw) {');
const voiceHandlerEnd = app.indexOf('// Accept speech from the mobile', voiceHandlerStart);
assert.ok(voiceHandlerStart >= 0 && voiceHandlerEnd > voiceHandlerStart, 'Could not locate the voice command handler for behavior tests.');
const voiceHandlerSource = app.slice(voiceHandlerStart, voiceHandlerEnd);
const expectedTaskPhrases = [
  'Add DSA assignment due tomorrow',
  'I need to study Python tomorrow',
  'Kal mujhe DBMS assignment submit karna hai',
  'Remind me to call Mom on Friday'
];
for (const phrase of expectedTaskPhrases) {
  const sandbox = {
    data: { tasks: [], expenses: [] },
    page: 'overview',
    today: () => {
      const d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    },
    dateFmt: value => value || 'No date',
    uid: () => 'voice-smoke-task',
    persist: () => {},
    toast: () => {},
    speakVoiceConfirmation: () => {},
    confirm: () => true,
    render: () => {},
    document: { querySelector: () => null },
    alert: () => {},
    console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(voiceHandlerSource, sandbox, { filename: 'voice-task-handler.js' });
  const handled = sandbox.handleStudentBrainVoiceCommand(phrase);
  assert.equal(handled, true, 'Voice task command was not handled: ' + phrase);
  assert.equal(sandbox.data.tasks.length, 1, 'Voice task was not saved exactly once: ' + phrase);
  assert.ok(sandbox.data.tasks[0].title.trim().length > 0, 'Voice task title is empty: ' + phrase);
  assert.equal(sandbox.page, 'planner', 'Voice task should open the Planner after saving: ' + phrase);
}


// App shell and major interaction routes must remain wired.
for (const selector of ['#page-content', '#modal-root', '#toast']) {
  const id = selector.slice(1);
  assert.ok(
    new RegExp(`id=["']${id}["']`).test(html),
    `Missing app shell selector: ${selector}`
  );
}
for (const feature of [
  'function notesCards()', 'function saveForm(', 'function persist()',
  'function processUploadedDocuments(', 'function askDocument(',
  'function restoreData()', 'function exportData()',
  'function studyPlanner()', 'function projects()', 'function expenses()',
  'function planner()', 'function personalMemory()', 'function openMemoryForm(',
  'data-action="delete-note"', 'data-action="delete-document"',
  'id="note-search"', 'id="subject-filter"', 'id="document-upload"',
  'data-action="go-ask"', 'function render()', 'data-action="planner-view"',
  'new-memory', 'edit-memory', 'delete-memory',
  "'memories'", 'data.memories',
]) {
  assert.ok(app.includes(feature), `Regression guard missing: ${feature}`);
}

assert.ok(html.includes('data-page="memory"'), 'Personal memory navigation entry is missing from the app shell.');

// Ensure CRUD and local persistence hooks stay present.
for (const action of [
  'new-note', 'edit-note', 'delete-note', 'new-task', 'edit-task',
  'delete-task', 'new-project', 'edit-project', 'new-expense',
  'edit-expense', 'delete-expense', 'new-study', 'delete-study',
  'export-data', 'restore-data'
]) assert.ok(app.includes(action), `Missing workflow action: ${action}`);

assert.match(app, /localStorage\.setItem\(KEY,JSON\.stringify\(data\)\)/);
assert.match(app, /localStorage\.getItem\(KEY\)/);
assert.match(app, /function migrateData\(raw\)/);
assert.match(app, /function splitDocumentIntoChunks\(text\)/);
assert.match(app, /if\(!file \|\| file\.size===0\)/);
assert.match(app, /Unsupported file type\. Upload a PDF or image\./);

console.log('Student Brain static regression guardrails passed: core pages, daily planner, personal memory, voice routing, spoken task-save behavior, chat file uploads, data safety and CRUD routes.');
console.log('Note: UI behavior, OCR extraction, backup round-trip, and mobile layout still require browser/device testing.');
