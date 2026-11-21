const fs = require('node:fs');
const assert = require('node:assert/strict');

const base = 'https://arbaj-k.github.io/one/';
const html = fs.readFileSync('index.html', 'utf8');
const about = fs.readFileSync('about.html', 'utf8');
const terms = fs.readFileSync('terms.html', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');

assert.match(html, /<link rel="canonical" href="https:\/\/arbaj-k\.github\.io\/one\/">/);
assert.match(html, /<meta name="robots" content="index, follow/);
assert.match(html, /application\/ld\+json/);
assert.match(html, /"@type": "SoftwareApplication"/);
assert.match(html, /id="one-public-seo-title"/);
assert.match(html, /personal AI assistant/i);
assert.match(about, /rel="canonical" href="https:\/\/arbaj-k\.github\.io\/one\/about\.html"/);
assert.match(terms, /rel="canonical" href="https:\/\/arbaj-k\.github\.io\/one\/terms\.html"/);
assert.match(robots, new RegExp('Sitemap: ' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 'sitemap\\.xml'));
for (const path of ['', 'about.html', 'terms.html']) {
  assert.ok(sitemap.includes('<loc>' + base + path + '</loc>'), 'Missing canonical sitemap URL: ' + path);
}
assert.ok(![html, about, terms, robots, sitemap].some(content => content.includes('arbaj-k.github.io/student-brain')));
console.log('SEO canonical, metadata, structured-data and sitemap guardrails passed.');
