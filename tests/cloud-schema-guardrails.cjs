const fs = require('node:fs');
const assert = require('node:assert/strict');
const sql = fs.readFileSync('supabase/migrations/202611050002_cloud_data_foundation.sql', 'utf8');
for (const table of ['user_workspaces','ai_chat_messages','user_documents']) {
  assert.match(sql, new RegExp('create table if not exists public\\.' + table));
  assert.match(sql, new RegExp('alter table public\\.' + table + ' enable row level security'));
}
for (const policy of ['workspace owner select','workspace owner insert','workspace owner update','workspace owner delete','chat owner select','chat owner insert','chat owner update','chat owner delete','documents owner select','documents owner insert','documents owner update','documents owner delete']) {
  assert.ok(sql.includes('create policy "' + policy + '"'), 'Missing owner policy: ' + policy);
}
assert.ok(sql.includes("values ('one-user-documents', 'one-user-documents', false"), 'Private document bucket definition missing');
assert.ok(sql.includes('storage.foldername(name)') && sql.includes('(select auth.uid())::text'), 'Storage object owner path restriction missing');
assert.ok(sql.includes('on delete cascade'), 'Auth-user cascade cleanup missing');
console.log('Cloud schema guardrails passed: owner-bound tables, RLS, private document bucket and auth-user cleanup.');
