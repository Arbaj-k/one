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
  await page.evaluate(()=>localStorage.setItem('student-brain-data-v1',JSON.stringify({schemaVersion:2,notes:[],tasks:[],projects:[],expenses:[],messages:[],studySessions:[],documents:[],memories:[]})));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  assert.ok(await page.locator('#page-content').innerText().then(t=>t.includes('Good to see you again')));
  // Exercise task creation through the actual planner UI and verify persistence.
  await page.locator('button[data-page="planner"]').first().click();
  await page.locator('[data-action="new-task"]').first().click();
  const taskForm=page.locator('#edit-form');
  await taskForm.locator('[name="title"]').fill('Browser regression task');
  await taskForm.locator('[name="due"]').fill(new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0'));
  await taskForm.locator('button[type="submit"]').click();
  await page.getByText('Browser regression task',{exact:true}).waitFor();
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1')));
  assert.ok(saved.tasks.some(t=>t.title==='Browser regression task'),'Task UI save must persist to workspace storage.');

  // Exercise Money & Udhaar create form and verify the amount/category record.
  await page.locator('button[data-page="expenses"]').first().click();
  await page.locator('[data-action="new-expense"]').first().click();
  const expenseForm=page.locator('#edit-form');
  await expenseForm.locator('[name="description"]').fill('Browser regression expense');
  await expenseForm.locator('[name="amount"]').fill('125');
  await expenseForm.locator('[name="date"]').fill(new Date().toISOString().slice(0,10));
  await expenseForm.locator('button[type="submit"]').click();
  await page.getByText('Browser regression expense',{exact:true}).waitFor();
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1')));
  assert.ok(saved.expenses.some(e=>e.description==='Browser regression expense'&&Number(e.amount)===125),'Expense UI save must persist its description and amount.');

  // Exercise Knowledge note creation and ensure saved text survives a reload.
  await page.locator('button[data-page="knowledge"]').first().click();
  await page.locator('[data-action="new-note"]').first().click();
  const noteForm=page.locator('#edit-form');
  await noteForm.locator('[name="title"]').fill('Browser regression knowledge');
  await noteForm.locator('[name="content"]').fill('A reliable browser regression fixture.');
  await noteForm.locator('button[type="submit"]').click();
  await page.getByText('Browser regression knowledge',{exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('student-brain-data-v1')));
  assert.ok(saved.notes.some(n=>n.title==='Browser regression knowledge'&&n.content.includes('reliable browser')),'Knowledge note must persist across reload.');

  await page.evaluate(()=>navigator.serviceWorker?.ready);
  await page.context().setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-content');
  assert.ok(await page.locator('#page-content').count());
  await page.context().setOffline(false);
  assert.deepEqual(errors,[]);
  console.log('Playwright browser regression passed: app boot, task create, expense create, knowledge note create, reload persistence and offline shell navigation.');
 }catch(err){console.error(err);process.exitCode=1}
 finally{if(browser)await browser.close();server.kill()}
})();
