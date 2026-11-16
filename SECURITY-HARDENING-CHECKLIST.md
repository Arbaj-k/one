# One — defensive security verification checklist

This checklist is for the Supabase project configured by `supabase-client.js`.

## Database RLS

Run in the Supabase SQL Editor and inspect every exposed table containing user-owned data.

```sql
-- Tables that should be owner-isolated must have RLS enabled.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- Inspect existing policies; review every policy for permissive OR combinations.
select schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
from pg_policies
where schemaname in ('public','storage')
order by schemaname, tablename, policyname;
```

For each user-owned table (including `user_workspaces`, `user_profiles`, `tasks`, `notes`, `projects`, `expenses`, `user_documents`, and notification/subscription tables as applicable):

- Enable RLS; consider `FORCE ROW LEVEL SECURITY` where compatible with server-side operations.
- SELECT/UPDATE/DELETE policies must constrain rows with `auth.uid() = user_id`.
- INSERT policies must use `WITH CHECK (auth.uid() = user_id)`.
- UPDATE policies must use both `USING (auth.uid() = user_id)` and `WITH CHECK (auth.uid() = user_id)`.
- Do not grant `anon` access to private workspace tables. Keep service-role keys exclusively server-side.
- Test with two different authenticated users: each must be unable to select, update, or delete the other's rows, even when supplying the other user's UUID.

Example policy pattern (adapt table/column names and consolidate with existing policies rather than blindly duplicating):

```sql
alter table public.user_workspaces enable row level security;
create policy "workspace owner select"
on public.user_workspaces for select to authenticated
using (auth.uid() = user_id);
create policy "workspace owner insert"
on public.user_workspaces for insert to authenticated
with check (auth.uid() = user_id);
create policy "workspace owner update"
on public.user_workspaces for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
create policy "workspace owner delete"
on public.user_workspaces for delete to authenticated
using (auth.uid() = user_id);
```

## Storage buckets

- Keep Vault/document buckets private; do not enable public listing or public object reads.
- For `storage.objects`, SELECT/INSERT/UPDATE/DELETE policies must check the bucket ID and owner.
- Prefer paths beginning with the authenticated UUID and enforce `(storage.foldername(name))[1] = auth.uid()::text` in addition to bucket matching where that is the app's path convention.
- Verify UPDATE uses both `USING` and `WITH CHECK`; test cross-user object IDs and guessed paths.

## Edge Functions: `student-brain-ai` and `account-delete`

- In `supabase/config.toml`, explicitly set `verify_jwt = true` for both functions. Confirm this in the Dashboard's Edge Functions settings/deploy configuration.
- Each function must validate the authenticated user from the verified JWT; never trust a client-supplied `user_id`.
- `account-delete` must require a valid user session and perform deletion only for that JWT subject. Keep service-role credentials in function secrets only.
- Add per-user rate limiting (and an IP-level abuse limit) for AI and account deletion; use a durable server-side counter/queue or an API gateway, not a client-side timer. Set request-body and uploaded-file limits.
- Use strict CORS allowlisting: allow only `https://arbaj-k.github.io` (plus explicitly approved development origins when needed); reject `null`, wildcard origins, and arbitrary `*.pages.dev` origins. Return `Vary: Origin`. CORS is not authentication—JWT verification and authorization remain mandatory.
- Important deployment note: if the live frontend is still served from `https://one-7na.pages.dev`, adding only `https://arbaj-k.github.io` will block browser calls from that live host. Either deploy the app at the requested GitHub Pages origin or explicitly approve the actual production origin before enforcing the allowlist.

## Dashboard release checks

1. Authentication: JWT verification enabled for both functions; expired/missing tokens return 401.
2. CORS: test allowed origin, unapproved origin, and `Origin: null`; only approved origin receives `Access-Control-Allow-Origin`.
3. Rate limits: repeated AI calls and repeated delete attempts receive 429 after the configured threshold.
4. Data isolation: run two-account CRUD and Storage tests; inspect logs for denied cross-user access.
5. Secrets: no service-role key or provider secret in browser files, repository history, or build artifacts.
6. Logs: redact prompts, note content, document contents, amounts, emails, tokens, and signed URLs.

## Known client-side dependency hardening item

CDN versions are pinned and anonymous CORS loading is used, but exact SHA-384/512 SRI hashes were not added in this pass because they must be calculated from the exact deployed bytes; inventing a hash would prevent the library from loading. Before claiming SRI complete, calculate hashes from the downloaded release files, commit the vendored/pinned assets (preferred), and verify the PDF.js worker and Tesseract worker/core/language-data paths under CSP. The current CSP retains the minimum CDN origins needed by the existing PDF/OCR path; self-hosting those assets is required to reduce `connect-src` to only self plus Supabase.
