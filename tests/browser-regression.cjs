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
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  await page.evaluate(()=>localStorage.setItem('student-brain-data-v1-guest',JSON.stringify({schemaVersion:2,notes:[],tasks:[],projects:[],expenses:[],messages:[],studySessions:[],documents:[],memories:[]})));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  assert.ok(await page.locator('#page-content').innerText().then(t=>t.includes('Good to see you again')));
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
  await page.context().setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  assert.ok(await page.locator('#page-content').count());
  await page.context().setOffline(false);

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
  console.log('Playwright browser regression passed: app boot, task create, expense create, knowledge note create, reload persistence and offline shell navigation.');
 }catch(err){console.error(err);process.exitCode=1}
 finally{if(browser)await browser.close();server.kill()}
})();
