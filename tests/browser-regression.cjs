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
  await page.evaluate(()=>navigator.serviceWorker?.ready);
  await page.context().setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  assert.ok(await page.locator('#page-content').count());
  await page.context().setOffline(false);
  assert.deepEqual(errors,[]);
  console.log('Playwright browser regression passed: app boot, reload persistence and offline shell navigation.');
 }catch(err){console.error(err);process.exitCode=1}
 finally{if(browser)await browser.close();server.kill()}
})();
