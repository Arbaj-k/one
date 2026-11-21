const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const server = spawn(process.execPath, ['-e', `
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
http.createServer((req,res)=>{let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(p==='/'||p.endsWith('/'))p+='/index.html';p=path.join(root,p.replace(/^\\//,''));if(!p.startsWith(root)){res.writeHead(403).end();return}fs.readFile(p,(e,b)=>{if(e){res.writeHead(404).end('not found');return}res.setHeader('Content-Type',mime[path.extname(p)]||'application/octet-stream');res.end(b)})}).listen(4173,'127.0.0.1');
`], { stdio:'ignore' });
(async()=>{
 let browser;
 try{
  await new Promise(resolve=>setTimeout(resolve,600));
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  await context.grantPermissions(['notifications'],{origin:'http://127.0.0.1:4173'});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.Tesseract={recognize:async()=>({data:{text:'University library notice. Opening hours Monday to Friday, 9 AM to 5 PM. Contact the library desk for assistance.',confidence:96}})};
    window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'University library notice. Opening hours Monday to Friday, 9 AM to 5 PM.',transform:[1,0,0,1,10,100]}]}),cleanup(){}})})})};
  });
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  await page.evaluate(()=>{
    const shifted=new Date(Date.now()-2*60*1000);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(shifted);
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(shifted).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    const reminder={id:'browser-reminder-regression',title:'Browser notification regression',category:'Briefing',taskType:'reminder',isReminder:true,due:date,reminderTime:parts.hour+':'+parts.minute,repeatRule:'daily',priority:'Medium',done:false,created:Date.now(),updated:Date.now()};
    localStorage.setItem('student-brain-data-v1-guest',JSON.stringify({schemaVersion:4,notes:[],tasks:[reminder],projects:[],expenses:[],messages:[],studySessions:[],documents:[],memories:[],notifications:[]}));
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  assert.ok(await page.locator('#page-content').innerText().then(t=>t.includes('Good to see you again')));
  // Routine notifications also use the same Asia/Kolkata clock, independent of browser timezone.
  await page.evaluate(()=>{
    const shifted=new Date(Date.now()-2*60*1000);
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(shifted).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    const routine={id:'browser-routine-regression',title:'Browser daily routine',repeatRule:'daily',time:parts.hour+':'+parts.minute,created:Date.now()};
    const key='student-brain-data-v1-guest',data=JSON.parse(localStorage.getItem(key)||'{}');
    data.routines=[routine];localStorage.setItem(key,JSON.stringify(data));
  });
  // Real Chromium notification path: the due reminder must surface through the active service worker.
  await page.waitForFunction(async()=>{
    try{const reg=await navigator.serviceWorker.ready;const items=await reg.getNotifications();return items.some(n=>n.title==='One · Routine reminder'&&n.body.includes('Browser daily routine'))}catch{return false}
  },null,{timeout:15000});
  await page.waitForFunction(async()=>{
    try{const reg=await navigator.serviceWorker.ready;const items=await reg.getNotifications();return items.some(n=>n.title==='One · Task reminder'&&n.body.includes('Browser notification regression'))}catch{return false}
  },null,{timeout:15000});
  // Exercise task creation through the actual planner UI and verify persistence.
  await page.locator('.stat-card[data-page="planner"]').first().click();
  await page.locator('[data-action="new-task"]').first().click();
  const taskForm=page.locator('#edit-form');
  await taskForm.locator('[name="title"]').fill('Browser regression task');
  await taskForm.locator('[name="due"]').fill(new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0'));
  await taskForm.locator('button[type="submit"]').click();
  // Saving closes the modal; verify the persisted model directly rather than
  // assuming the task appears in the current Today/Upcoming filtered view.
  await taskForm.waitFor({state:'detached',timeout:10000});
  await page.waitForFunction(()=>{try{return JSON.parse(localStorage.getItem('student-brain-data-v1-guest')||'{}').tasks?.some(t=>t.title==='Browser regression task')}catch{return false}},null,{timeout:10000});
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1-guest')));
  assert.ok(saved.tasks.some(t=>t.title==='Browser regression task'),'Task UI save must persist to workspace storage.');

  // Exercise the image OCR and PDF text-extraction paths with deterministic browser test adapters.
  await page.locator('button[data-page="vault"]').first().click();
  await page.locator('#document-upload').setInputFiles({name:'browser-ocr.png',mimeType:'image/png',buffer:Buffer.from('fake-png-fixture')});
  const imageForm=page.locator('#edit-form');
  await imageForm.locator('[name="name"]').fill('Browser OCR image');
  await imageForm.locator('.modal-save-button').click();
  await page.getByRole('heading',{name:'Browser OCR image',exact:true}).waitFor({timeout:15000});
  let documents=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1-guest')).documents);
  assert.ok(documents.some(d=>d.name==='Browser OCR image'&&d.originalName==='browser-ocr.png'&&d.mimeType==='image/png'&&d.extractedText.includes('University library notice')&&d.ocrStatus==='complete'),'Image upload must OCR text and save it with the normalized MIME type.');
  await page.locator('#document-upload').setInputFiles({name:'browser-text.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fake fixture')});
  const pdfForm=page.locator('#edit-form');
  await pdfForm.locator('[name="name"]').fill('Browser OCR PDF');
  await pdfForm.locator('.modal-save-button').click();
  await page.getByRole('heading',{name:'Browser OCR PDF',exact:true}).waitFor({timeout:15000});
  documents=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1-guest')).documents);
  assert.ok(documents.some(d=>d.name==='Browser OCR PDF'&&d.originalName==='browser-text.pdf'&&d.mimeType==='application/pdf'&&d.extractedText.includes('University library notice')&&d.ocrStatus==='complete'),'PDF upload must extract text and save its MIME type.');

  // Return home before using the dashboard shortcut for Money & Udhaar.
  await page.locator('.back-home-icon').click();
  // Exercise Money & Udhaar create form and verify the amount/category record.
  await page.locator('.stat-card[data-page="expenses"]').first().click();
  await page.locator('[data-action="new-expense"]').first().click();
  const expenseForm=page.locator('#edit-form');
  await expenseForm.locator('[name="description"]').fill('Browser regression expense');
  await expenseForm.locator('[name="amount"]').fill('125');
  await expenseForm.locator('[name="date"]').fill(new Date().toISOString().slice(0,10));
  await expenseForm.locator('button[type="submit"]').click();
  await page.getByText('Browser regression expense',{exact:true}).waitFor();
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1-guest')));
  assert.ok(saved.expenses.some(e=>e.description==='Browser regression expense'&&Number(e.amount)===125),'Expense UI save must persist its description and amount.');
  // Verify slash-command expense routing through Ask One end-to-end (no AI dependency).
  await page.locator('button[data-page="ask"]').first().click();
  const askInput=page.locator('#chat-input');
  await askInput.fill('/expense add 50 ruppee in expense');
  await page.locator('#chat-form button[type="submit"]').click();
  await page.getByText(/confirm expense\/income:.*₹50/i).waitFor({timeout:15000});
  await page.locator('[data-action="confirm-pending-action"]').last().click();
  await page.waitForFunction(()=>{try{return JSON.parse(localStorage.getItem('student-brain-data-v1-guest')||'{}').expenses?.some(e=>Number(e.amount)===50&&e.kind==='expense')}catch{return false}},null,{timeout:10000});
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1-guest')));
  assert.ok(saved.expenses.some(e=>Number(e.amount)===50&&e.kind==='expense'&&e.description==='Other'),'Ask One slash expense command should save a normal expense without person name.');

  // Return home before opening the Notes dashboard shortcut.
  await page.locator('.back-home-icon').click();
  // Exercise Knowledge note creation and ensure saved text survives a reload.
  await page.locator('.stat-card[data-page="notes"]').first().click();
  await page.locator('[data-action="new-note"]').first().click();
  const noteForm=page.locator('#edit-form');
  await noteForm.locator('[name="title"]').fill('Browser regression knowledge');
  await noteForm.locator('[name="content"]').fill('A reliable browser regression fixture.');
  await noteForm.locator('button[type="submit"]').click();
  await page.getByText('Browser regression knowledge',{exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1-guest')));
  assert.ok(saved.notes.some(n=>n.title==='Browser regression knowledge'&&n.content.includes('reliable browser')),'Knowledge note must persist across reload.');

  await page.evaluate(()=>navigator.serviceWorker?.ready);
  const precached=await page.evaluate(async()=>{
    const cache=await caches.open('one-assets-v42');
    const paths=['./app.js','./styles.css','./auth.js','./group-trip.js','./quality-guardrails.css'];
    const results={};for(const path of paths)results[path]=!!await cache.match(new URL(path,location.href).href);
    return results;
  });
  assert.ok(Object.values(precached).every(Boolean),'Fresh PWA install must precache all core JS/CSS modules in the cache used by offline fetch handling: '+JSON.stringify(precached));
  await page.context().setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  assert.ok(await page.locator('#page-content').count());
  await page.context().setOffline(false);

  // Long Ask One histories must remain visible and scrollable.
  await page.evaluate(()=>{
    const key='student-brain-data-v1-guest',data=JSON.parse(localStorage.getItem(key)||'{}');
    data.messages=Array.from({length:48},(_,i)=>({id:'chat-regression-'+i,role:i%2?'assistant':'user',content:(i%2?'One reply ':'My message ')+(i+1)+' — readable history fixture. '.repeat(3),createdAt:Date.now()+i}));
    localStorage.setItem(key,JSON.stringify(data));
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  await page.locator('button[data-page="ask"]').first().click();
  const history=page.locator('#chat-messages');
  await history.waitFor({state:'visible'});
  const metrics=await history.evaluate(el=>({height:el.scrollHeight,client:el.clientHeight,overflow:getComputedStyle(el).overflowY,count:el.querySelectorAll('.bubble').length,first:el.querySelector('.bubble')?.innerText||''}));
  assert.ok(metrics.height>metrics.client,'Ask One messages must overflow a scrollable history area');
  assert.ok(['auto','scroll'].includes(metrics.overflow),'Ask One must allow vertical scrolling');
  assert.equal(metrics.count,48,'Older and newer messages must both render');
  assert.ok(metrics.first.includes('My message 1'),'Oldest message must remain available');
  await history.evaluate(el=>{el.scrollTop=0});
  assert.equal(await history.evaluate(el=>el.scrollTop),0,'User must be able to scroll to chat history start');
  const composer=page.locator('#chat-input');
  await composer.fill('Visible composer regression');
  assert.equal(await composer.inputValue(),'Visible composer regression','Chat composer must accept typed text');
  await page.locator('button[data-page="overview"]').first().click();

  // Mobile layout: the old navigation was intentionally removed; verify
  // replacement home shortcuts remain reachable and each destination fits.
  const mobile=await context.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const mobileErrors=[];mobile.on('pageerror',e=>mobileErrors.push(e.message));
  await mobile.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'});
  await mobile.waitForSelector('#page-content');
  const mobileLayout=await mobile.evaluate(()=>({
    viewport:document.documentElement.clientWidth,
    documentWidth:document.documentElement.scrollWidth,
    createVisible:!!document.querySelector('.floating-create-button')&&getComputedStyle(document.querySelector('.floating-create-button')).display!=='none',
    shortcuts:[...document.querySelectorAll('#page-content [data-page]')].filter(x=>getComputedStyle(x).display!=='none').length
  }));
  assert.ok(mobileLayout.createVisible,'Mobile Create shortcut must be visible');
  assert.ok(mobileLayout.shortcuts>=5,'Home must expose reachable shortcuts without restoring removed navigation');
  assert.ok(mobileLayout.documentWidth<=mobileLayout.viewport+1,'Mobile layout must not overflow horizontally');
  const mobileRoutes=[
    ['planner','.stat-card[data-page="planner"]'],
    ['uploads','.stat-card[data-page="uploads"]'],
    ['notes','.stat-card[data-page="notes"]'],
    ['expenses','.stat-card[data-page="expenses"]'],
    ['projects','button[data-page="projects"]'],
    ['ask','button[data-page="ask"]']
  ];
  for(const [section,selector] of mobileRoutes){
    await mobile.locator(selector).first().click();
    await mobile.waitForTimeout(60);
    const widths=await mobile.evaluate(()=>({viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth}));
    assert.ok(widths.document<=widths.viewport+1,'Mobile '+section+' page must not overflow horizontally');
    if(section!=='ask')await mobile.locator('.back-home-icon').click();
  }
  assert.deepEqual(mobileErrors,[]);
  await mobile.close();
  assert.deepEqual(errors,[]);
  console.log('Playwright browser regression passed: app boot, service-worker reminder notification, task create, expense create, knowledge note create, reload persistence and offline shell navigation.');
 }catch(err){console.error(err);process.exitCode=1}
 finally{if(browser)await browser.close();server.kill()}
})();
