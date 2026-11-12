# One Android push notifications

The One Web Push backend is configured in Supabase. VAPID public/private keys and the scheduler authentication secret are stored in a private RLS-protected server configuration table; they are not in the browser bundle or GitHub.

## Active server setup

- Supabase Edge Function: `one-push`
- Push subscription and delivery tables: `one_push_subscriptions`, `one_push_deliveries`
- Private server configuration: `one_push_server_config` (RLS enabled; anon/authenticated cannot read it)
- Scheduler: `one-push-every-minute` using `pg_cron` and `pg_net`
- Schedule: every minute
- Dispatcher verifies a server-held secret and uses idempotency keys to avoid duplicate reminders.

## Enable on Android

1. Open the deployed One site in Chrome on Android and sign in.
2. Install One from Chrome's menu for the best app-like experience.
3. Open Settings → One notifications → Enable Android notifications.
4. Allow notifications when Android asks. One registers this device and sends a test push.
5. Keep Android notifications enabled for One in system settings.

## Current delivery scope

The scheduled dispatcher checks cloud workspace tasks due today and sends at the task's saved `reminderTime` (Asia/Kolkata). Document-expiry and Udhaar reminders are currently supported by the in-app/local reminder experience while One is running; server-side push scheduling for those types is not yet enabled.

## Verification

The scheduler job is active and its latest HTTP call returned HTTP 200 with `ok: true`. A real phone delivery still requires at least one Android device to subscribe. Device subscription count was zero at the last server check, so no actual phone notification has been received yet.

## Troubleshooting

- If Chrome does not ask for permission, open Chrome site settings for One and allow Notifications.
- If push subscription fails, check that One is served over HTTPS and that the user is signed in.
- Android battery saver or force-stop may delay background delivery.
