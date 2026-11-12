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

The scheduled dispatcher checks cloud workspace tasks at their saved `reminderTime` (Asia/Kolkata). At 09:00 Asia/Kolkata it sends one daily digest per account with all unfinished dated tasks, Assignment/Reminder/Briefing items, document expiries due within 7 days (including overdue), and outstanding Udhaar due within 7 days (including overdue). Completed tasks and fully repaid Udhaar are excluded; newly added pending items appear in the next digest.

## Verification

The scheduler job is active and its latest HTTP call returned HTTP 200 with `ok: true`. At the latest check, one Android device subscription is registered. The scheduled HTTP dispatcher is returning HTTP 200; delivery to the user's device still depends on Chrome/Android notification permission and device power/network settings.

## Troubleshooting

- If Chrome does not ask for permission, open Chrome site settings for One and allow Notifications.
- If push subscription fails, check that One is served over HTTPS and that the user is signed in.
- Android battery saver or force-stop may delay background delivery.
