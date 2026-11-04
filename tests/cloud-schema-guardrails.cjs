const fs = require('node:fs');
const assert = require('node:assert/strict');
const sql = fs.readFileSync('supabase/migrations/202611050002_cloud_data_foundation.sql', 'utf8');
for (const table of ['user_workspaces','ai_chat_messages','user_documents']) {
  assert.match(sql, new RegExp('create table if not exists public\\.' + table));
  assert.match(sql, new RegExp('alter table public\\.' + table + ' enable row level security'));
  assert.match(sql, new RegExp('auth.uid\\(\\).*user_id|auth.uid\\(\\).*user_id', 's'));
}
assert.match(sql, /create policy "workspace owner select"/);
assert.match(sql, /create policy "chat owner insert"/);
assert.match(sql, /create policy "documents owner delete"/);
assert.match(sql, /values \('one-user-documents', 'one-user-documents', false/);
assert.match(sql, /storage\.foldername\(name\).*auth\.uid\(\)/s);
assert.match(sql, /on delete cascade/);
console.log('Cloud schema guardrails passed: owner-bound tables, RLS, private document bucket and auth-user cleanup.');
