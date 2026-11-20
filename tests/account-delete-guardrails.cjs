const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('supabase/functions/account-delete/index.ts', 'utf8');

// Deletion must always re-read the first page after removing objects. Advancing
// an offset while the result set shrinks can skip objects beyond the first page.
assert.match(source, /list\(folder, \{ limit: 100, offset: 0 \}\)/);
assert.ok(!/offset\s*\+=\s*100/.test(source), 'Storage cleanup must not advance offsets while deleting');
assert.match(source, /for\s*\(;;\)\s*\{/);
assert.match(source, /if\s*\(!entries\?\.length\)\s*break/);
assert.match(source, /Storage folder cleanup did not make progress/);

// A missing optional legacy table is tolerated, but unrelated database errors
// must still stop deletion rather than silently leave user data behind.
assert.match(source, /error\.code === "42P01"/);
assert.match(source, /error\.code === "PGRST205"/);
assert.match(source, /if \(historyError && !isMissingRelation\(historyError\)\) throw historyError/);

// Preserve a retry path: revoke sessions only after storage and row cleanup,
// immediately before deleting the auth identity.
const cleanup = source.indexOf('await removeFolder(userId)');
const history = source.indexOf('whatsapp_processed_messages');
const revoke = source.indexOf('admin.auth.admin.signOut(token, "global")');
const deleteUser = source.indexOf('admin.auth.admin.deleteUser(userId)');
assert.ok(cleanup >= 0 && history > cleanup && revoke > history && deleteUser > revoke,
  'Deletion order must clean owned data, then revoke sessions, then delete the identity');
assert.match(source, /body\?\.confirmation !== "DELETE"/);
assert.match(source, /auth\.getUser\(token\)/);
console.log('Account deletion guardrails passed: paginated storage cleanup, retry-safe ordering, explicit confirmation and authenticated caller.');
