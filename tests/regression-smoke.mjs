import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const voice = readFileSync(new URL('../voice-assistant.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// Syntax validation catches startup-breaking parse errors.
execFileSync(process.execPath, [
  '--check',
  fileURLToPath(new URL('../app.js', import.meta.url))
]);

execFileSync(process.execPath, [
  '--check',
  fileURLToPath(new URL('../voice-assistant.js', import.meta.url))
]);
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

assert.ok(app.includes('async function requestStudentBrainAI('), 'Ask My Brain must call the secure AI function.');
assert.ok(app.includes('/functions/v1/student-brain-ai'), 'Ask My Brain AI endpoint is missing.');
assert.ok(app.includes('signInAnonymously()'), 'Ask My Brain must create an anonymous Supabase session without email login.');
assert.ok(app.includes('const AI_FILES_DB='), 'Original file browser storage is missing.');
assert.ok(!app.includes('dataBase64:await fileToBase64(saved.blob)'), 'Ask My Brain should use extracted text only, not send original PDF/image for multimodal analysis.');
assert.ok(app.includes('async function sendChat('), 'Ask My Brain must use the asynchronous AI response flow.');
assert.ok(app.includes('function chatActionIntent('), 'Quick task and money actions must remain available.');
assert.ok(!app.includes('GEMINI_API_KEY'), 'Gemini API secret must never be present in browser code.');
assert.ok(app.includes("const label='File: '+hit.doc.name"), 'Document citation labels should remain in the query-aware evidence builder.');
assert.ok(app.includes('async function retryDocumentOCR('), 'Uploaded documents must support a retry/re-upload path.');
assert.ok(app.includes('async function runImageOCR(file)'), 'Image OCR extraction must be available.');
assert.ok(app.includes('const extractedJson=documentTextToJSON('), 'Uploaded document text must be normalized into JSON.');
assert.ok(app.includes('extractedJson'), 'Extracted JSON must be saved with the uploaded document.');
assert.ok(!app.includes('dataBase64:await fileToBase64(saved.blob)'), 'Original files must not be sent to multimodal AI analysis.');
assert.ok(app.includes('free-tier content may be used to improve Google products'), 'AI data-use disclosure is missing from the Ask My Brain UI.');


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
assert.match(app, /localStorage\.getItem\(KEY\+'-last-good'\)/, 'Corrupt primary local data must attempt recovery from the last-good snapshot.');
assert.match(app, /function parseBackupPayload\(parsed\)/, 'Restore must validate the backup payload before replacing workspace data.');
assert.match(app, /function updateRestorePreview\(\)/, 'Restore file selection must provide a validation preview.');
assert.match(app, /id="restore-preview"/, 'Backup and restore page must expose accessible restore feedback.');
assert.match(app, /localStorage\.setItem\(KEY\+'-pre-restore'/, 'Restore must preserve a pre-restore recovery snapshot.');
assert.match(css, /\.restore-preview/, 'Restore preview needs a visible responsive style.');
assert.match(css, /@media\(max-width:700px\)[\s\S]*\.backup-grid/, 'Backup/restore layout must be polished for mobile.');

assert.match(app, /function migrateData\(raw\)/);
assert.match(app, /function splitDocumentIntoChunks\(text\)/);
assert.match(app, /if\(!file\s*\|\|\s*file\.size===0\)/);
assert.match(app, /Unsupported file type\. Upload a PDF or image\./);

console.log('Student Brain static regression guardrails passed: core pages, daily planner, personal memory, voice routing, spoken task-save behavior, chat file uploads, data safety and CRUD routes.');
console.log('Note: UI behavior, OCR extraction, backup round-trip, and mobile layout still require browser/device testing.');


// Query-aware AI retrieval tests: execute production helpers without external AI/API calls.
const retrievalStart = app.indexOf('function splitDocumentIntoChunks(text){');
const retrievalEnd = app.indexOf('async function buildStudentBrainAIRequest', retrievalStart);
assert.ok(retrievalStart >= 0 && retrievalEnd > retrievalStart, 'Could not locate retrieval helpers.');
const retrievalSandbox = { console, Set, Map, Math, String, Number, Object, Array, RegExp };
vm.createContext(retrievalSandbox);
vm.runInContext(app.slice(retrievalStart, retrievalEnd), retrievalSandbox, { filename: 'retrieval-helpers.js' });
const timetableDocs = [
 {id:'timetable',name:'Exam timetable.pdf',type:'pdf',extractedText:'[Page 2]\nSubject | Date | Start | End\nAEC | 31.10.2026 | 08:30 AM | 10:00 AM\nVAC | 31.10.2026 | 10:30 AM | 12:00 PM\nSEC | 31.10.2026 | 12:30 PM | 02:00 PM\nOpen Elective | 31.10.2026 | 02:30 PM | 04:00 PM'},
 {id:'unrelated',name:'Marketing notes.pdf',type:'pdf',extractedText:'[Page 1]\nMarketing strategy, segmentation, branding and consumer behaviour.'}
];
retrievalSandbox.testDocs = timetableDocs;
const query = (question, targetDocId = null) => vm.runInContext(
 'aiBuildDocumentEvidence(testDocs,' + JSON.stringify(question) + ',' + JSON.stringify(targetDocId) + ',{maxDocs:4,maxChunks:8,maxChars:8000})',
 retrievalSandbox
);
const tableWithBlankCell = vm.runInContext(
 "extractStructuredTables('[Page 4]\\nSubject | Date | Start | End\\nAEC | 31.10.2026 |  | 10:00 AM')",
 retrievalSandbox
);
assert.equal(tableWithBlankCell[0].page, 4, 'Structured table must retain its source page.');
assert.deepEqual(Array.from(tableWithBlankCell[0].columns), ['Subject','Date','Start','End'], 'Structured table headers must remain ordered.');
assert.deepEqual(Array.from(tableWithBlankCell[0].rows[0]), ['AEC','31.10.2026','','10:00 AM'], 'Blank table cells must remain blank instead of shifting the End value into Start.');
const tableWithMarkdownSeparator = vm.runInContext(
 "extractStructuredTables('Subject | Date | Start | End\\n--- | --- | --- | ---\\nAEC | 31.10.2026 | 08:30 AM | 10:00 AM')",
 retrievalSandbox
);
assert.equal(tableWithMarkdownSeparator[0].rows.length, 1, 'Markdown table separator rows must not be treated as data.');
const aec = query('AEC ka exam kab hai aur kitne baje?');
assert.ok(aec.evidence.length > 0, 'AEC question should retrieve timetable evidence.');
assert.equal(aec.evidence[0].doc.id, 'timetable', 'AEC question must rank the timetable above unrelated files.');
assert.ok(aec.evidence[0].text.includes('AEC | 31.10.2026 | 08:30 AM | 10:00 AM'), 'AEC result must preserve the exact timetable row.');
assert.equal(aec.evidence[0].page, 2, 'Retrieved timetable row must retain its exact page.');
const vac = query('When is VAC and what is the timing?');
assert.ok(vac.evidence[0].text.includes('VAC | 31.10.2026 | 10:30 AM | 12:00 PM'), 'VAC query must retrieve the matching row.');
const startEnd = query('AEC start time and end time');
assert.ok(startEnd.evidence.some(hit => hit.text.includes('08:30 AM') && hit.text.includes('10:00 AM')), 'Time-specific query must retain start and end times.');
const noLeak = query('What is the registration fee?');
assert.equal(noLeak.evidence.length, 0, 'Unmatched query must not inject arbitrary unrelated document chunks.');
const targeted = query('What is the VAC exam time?', 'timetable');
assert.ok(targeted.evidence.length > 0 && targeted.evidence.every(hit => hit.doc.id === 'timetable'), 'Ask-document retrieval must respect the selected document ID.');
const hi = vm.runInContext("aiQueryIntent('AEC ka exam kab hai?')", retrievalSandbox);
assert.ok(hi.subject.includes('aec') && hi.date, 'Hindi/Hinglish subject/date intent should be detected.');
assert.ok(vm.runInContext("extractTimetableData(testDocs[0].extractedText).some(row => row.course === 'AEC' && row.start === '08:30 AM' && row.end === '10:00 AM')", retrievalSandbox), 'Structured timetable extraction must preserve exact start/end times.');
assert.doesNotThrow(() => new Function(app.slice(retrievalStart, retrievalEnd)), 'Retrieval helpers must remain valid JavaScript.');
assert.ok(app.includes("timetable:extractTimetableData(doc.extractedText||'')"), 'Structured timetable rows must be included in AI context.');
assert.match(app, /const taskSummary='Save this task\\?/,'Voice task creation must confirm its summary before saving.');
assert.match(app, /if\(!confirm\(taskSummary\)\)\{toast\('Task not saved'\)/,'Cancelling voice task confirmation must not save.');
assert.match(app, /const moneySummary='Save this money record\\?/,'Voice money actions must confirm record details before saving.');
assert.match(app, /if\(!confirm\(moneySummary\)\)\{toast\('Money record not saved'\)/,'Cancelling money confirmation must not save.');
assert.match(app, /Saved task: '\+title/,'Voice task success confirmation must identify the saved task.');
assert.match(app, /Saved '\+category\+' '\+amountLabel/,'Voice money success confirmation must echo the saved amount and category.');

