# Secret handling for One

## Browser-safe configuration
The Supabase project URL and **publishable** key in `auth.js` are browser configuration, not privileged secrets. A publishable/legacy anon key is only safe to expose when every exposed table, view, function and Storage bucket is protected by correct RLS/policies. Never put a Supabase service-role/secret key in frontend files.

This is a static HTML/CSS/JavaScript app, so it does not have a server build step that can safely interpolate private environment variables into browser bundles. Do not replace a browser-safe publishable key with a private key or add secrets to frontend environment variables.

## Server-side secrets
Set Edge Function secrets in the Supabase project (or local Supabase secrets for development). Use `.env.example` only as a variable-name template. Never commit a populated `.env`.

The push Edge Function reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` through `Deno.env.get()`. The service-role key must remain server-side. VAPID private key and cron secret are read from the private `one_push_server_config` table; keep that table inaccessible to browser roles and do not expose its values in logs or API responses.

## Automated checks
GitHub Actions runs Gitleaks on pushes and pull requests. It checks the current changes and available commit history. Review every finding; do not blindly allowlist a credential. If a real secret was ever committed, rotate/revoke it at its provider immediately. Removing it from the latest commit does not remove it from Git history; history rewriting may be required after rotation.

## Incident response
1. Revoke/rotate the exposed credential first.
2. Check provider audit logs and usage for unexpected activity.
3. Remove the secret from current files and move it to server-side secret storage.
4. Rewrite Git history only after coordination with collaborators; force-push may disrupt clones and open PRs.
