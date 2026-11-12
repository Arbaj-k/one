# One Android push notification setup

The app UI, per-account subscription endpoint, service-worker push handler, Supabase tables, and Edge Function are deployed. Background delivery remains disabled until the VAPID secrets and one-minute scheduler below are configured.

## 1. Generate VAPID keys

On a trusted computer with Node.js, run:

```bash
npx web-push generate-vapid-keys
```

Keep the private key secret. Do not commit it or paste it into the app source.

## 2. Add Supabase Edge Function secrets

Open the One Supabase project (ref `tcthrfpkydcmenxwajfg`) → Edge Functions → Secrets and add:

- `VAPID_PUBLIC_KEY`: generated public key
- `VAPID_PRIVATE_KEY`: generated private key
- `VAPID_SUBJECT`: `mailto:your-real-support-email@example.com` (replace with an address you control)
- `ONE_PUSH_CRON_SECRET`: a long random secret (at least 32 random bytes)

The Supabase runtime supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Never put the service-role key in browser code.

## 3. Configure the scheduler

In Supabase Dashboard → Database → Extensions, enable `pg_cron`, `pg_net`, and `supabase_vault` (Vault may already be available).

In Vault, create two secrets:
- Name `one_push_url`, value `https://tcthrfpkydcmenxwajfg.supabase.co/functions/v1/one-push`
- Name `one_push_cron_secret`, value exactly the same value used for Edge Function secret `ONE_PUSH_CRON_SECRET`

Then run this SQL once in the Supabase SQL Editor:

```sql
select cron.schedule(
  'one-push-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'one_push_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-one-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'one_push_cron_secret')
    ),
    body := '{"action":"dispatch"}'::jsonb
  );
  $job$
);
```

Check the job with:

```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'one-push-every-minute';
```

## 4. Enable on Android

1. Deploy the latest One site and open it in Chrome on Android.
2. Sign in to the same One account that owns the tasks.
3. Install One from Chrome's menu for the best app-like experience.
4. Open Settings → One notifications → Enable Android notifications.
5. Allow notifications when Android asks. The app subscribes this device and sends a test push.

Android/Chrome must permit notifications and background data. Battery restrictions or force-stop can delay delivery.

## What is already active

- In-app notification centre and unread badge.
- Local task, document-expiry, and Udhaar reminder checks while One is open.
- Push subscription storage protected by server-side service-role access and user-scoped ownership.
- A server dispatcher that scans cloud workspace tasks and sends idempotent push reminders.

## Important limitation

The dispatcher currently covers task reminders at each task's saved `reminderTime` on its due date (Asia/Kolkata). Document-expiry and Udhaar reminders continue to appear in the in-app centre/browser notification check while One is running; server-side scheduling for those types can be added after task push is verified end-to-end.
