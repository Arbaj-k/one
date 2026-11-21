const fs = require('node:fs');
const assert = require('node:assert/strict');
const base = 'https://arbaj-k.github.io/one/';
const files = {
 home: fs.readFileSync('index.html','utf8'),
 about: fs.readFileSync('about.html','utf8'),
 terms: fs.readFileSync('terms.html','utf8'),
 task: fs.readFileSync('features/ai-task-manager/index.html','utf8'),
 notes: fs.readFileSync('features/notes-and-memory/index.html','utf8'),
 money: fs.readFileSync('features/expense-tracker/index.html','utf8'),
 ai: fs.readFileSync('features/personal-ai-assistant/index.html','utf8'),
 projects: fs.readFileSync('features/project-organizer/index.html','utf8'),
 documents: fs.readFileSync('features/document-organizer/index.html','utf8'),
 robots: fs.readFileSync('robots.txt','utf8'),
 sitemap: fs.readFileSync('sitemap.xml','utf8'),
 llms: fs.readFileSync('llms.txt','utf8')
};
assert.ok(files.home.includes('rel="canonical" href="'+base+'"'));
assert.match(files.home,/meta name="robots" content="index, follow/);
assert.match(files.home,/application\/ld\+json/);
assert.match(files.home,/"@type": "SoftwareApplication"/);
assert.match(files.home,/personal AI assistant/i);
assert.ok(files.about.includes('rel="canonical" href="'+base+'about.html"'));
for (const [key,slug] of [['ai','personal-ai-assistant'],['projects','project-organizer'],['documents','document-organizer']]) {
 assert.match(files[key],/<title>[^<]+<\/title>/,key+' title');
 assert.match(files[key],/name="description"/,key+' description');
 assert.ok(files[key].includes('rel="canonical" href="'+base+'features/'+slug+'/'),key+' canonical');
 assert.match(files[key],/<h1>/,key+' H1');
 assert.ok(files.sitemap.includes(base+'features/'+slug+'/'),'missing '+slug+' in sitemap');
 assert.ok(files.llms.includes(base+'features/'+slug+'/'),'missing '+slug+' in llms.txt');
}
assert.ok(files.terms.includes('rel="canonical" href="'+base+'terms.html"'));
for (const [key,slug] of [['task','ai-task-manager'],['notes','notes-and-memory'],['money','expense-tracker']]) {
 assert.match(files[key],/<title>[^<]+<\/title>/,key+' title');
 assert.match(files[key],/name="description"/,key+' description');
 assert.match(files[key],/rel="canonical"/,key+' canonical');
 assert.match(files[key],/<h1>/,key+' H1');
 assert.ok(files.sitemap.includes(base+'features/'+slug+'/'),'missing '+slug+' in sitemap');
}
assert.ok(files.robots.includes('Sitemap: '+base+'sitemap.xml'));
for (const bot of ['Googlebot','Google-Extended','OAI-SearchBot','ChatGPT-User','Claude-SearchBot','Claude-User','PerplexityBot']) {
 assert.match(files.robots,new RegExp('User-agent: '+bot+'\\nAllow: \\/'),bot+' should be allowed');
}
for (const bot of ['GPTBot','ClaudeBot']) {
 assert.match(files.robots,new RegExp('User-agent: '+bot+'\\nDisallow: \\/'),bot+' training crawler should be disallowed');
}
assert.match(files.llms,/^# One/m);
assert.ok(files.llms.includes(base),'llms.txt should point to canonical homepage');
for (const path of ['', 'about.html', 'features/ai-task-manager/', 'features/notes-and-memory/', 'features/expense-tracker/', 'features/personal-ai-assistant/', 'features/project-organizer/', 'features/document-organizer/', 'terms.html']) {
 assert.ok(files.sitemap.includes('<loc>'+base+path+'</loc>'),'missing sitemap URL '+path);
}
assert.ok(!Object.values(files).some(x=>x.includes('arbaj-k.github.io/student-brain')));
console.log('SEO, AI crawler policy, structured data, landing pages, internal links and sitemap guardrails passed.');
