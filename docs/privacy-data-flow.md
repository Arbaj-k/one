# One — Personal Data Flow & Privacy Audit

Audit scope: checked repository `main` and connected Supabase schema/policies on 2026-11-12. This is a code/schema audit, not a penetration test or legal certification.

## Data map

| Data | Collection | Storage / destination | Purpose / notes |
|---|---|---|---|
| Email | Email auth forms; Google OAuth | Supabase Auth; shown in profile UI | Login, verification, recovery. |
| Password | Email sign-up/login/reset | Sent over HTTPS to Supabase Auth | Supabase Auth handles password hashing/storage; One does not store password fields in workspace tables. |
| Display name/avatar | Sign-up or Google profile | Auth metadata and `user_profiles` profile row | Account display. |
| Notes/tasks/projects/money/memories/chat/reminders | One forms, Ask One, quick capture | Browser localStorage + IndexedDB; `public.user_workspaces`; chat may also be in `public.ai_chat_messages` | Offline and cloud workspace data. RLS owner policies apply to cloud rows. |
| Documents/file names/OCR | Document Vault upload and phone share | IndexedDB blob/cache; private `one-user-documents` bucket; `public.user_documents` metadata/OCR | File storage and retrieval. Bucket is private and folder policies are owner-scoped. |
| AI prompts/context | Ask One and document JSON | Browser → Supabase Edge Function → Google Gemini | User prompt and selected `aiPrivacy`-filtered context are sent to Gemini. Inline file content may be sent when document sharing is enabled. |
| Analytics | Page views and allowed usage events | Pseudonymous visitor ID in localStorage; `public.one_analytics_events` | Sends visitor ID, event name and page key; app event payload does not include note/chat/money content. |
| Push endpoint/key/user agent | User enables notifications | `public.one_push_subscriptions` | Sensitive device endpoint and key material used for delivery. |
| Notification text | Scheduled task reminder | Supabase push function → browser/OS push provider | Task title/date and linked note/document title can appear on lock screen. |
| Bank SMS transaction details | Optional Android SMS receiver | Parsed amount, direction, merchant, UPI reference, sender, time → `bank-sms-sync`; schema `public.bank_sms_transactions` | Companion sends parsed fields, not full SMS body. Server endpoint source is not in this repo. |
| WhatsApp phone/message metadata | No active form found in inspected current app | WhatsApp tables exist in Supabase | Runtime integration not found in this repository snapshot; actual transfer/retention not verified. |
| IP/device metadata | Network requests/provider infrastructure | Supabase, Google, push/hosting providers may process operational metadata | App analytics does not explicitly send IP. Provider logs are outside app control. |

## Third-party integrations

- **Supabase:** Auth, Postgres, private Storage, Realtime, Edge Functions and analytics. Receives auth credentials over HTTPS, cloud workspace/doc/chat data, and optional parsed SMS transaction fields. Browser uses a publishable key; service-role key is server-only.
- **Google Gemini:** receives Ask One prompt and selected workspace/document context. This is an external data transfer controlled by AI privacy settings.
- **Google OAuth:** authentication flow and identity/profile claims.
- **Browser push service:** subscription endpoint/key material and notification payloads.
- **CDNs:** Supabase JS, PDF.js and Tesseract.js load from jsDelivr/cdnjs. These scripts run in the app origin; no workspace payload is intentionally sent to the CDN hosts.
- No Stripe, SendGrid, Twilio or AWS client integration was found in the inspected repository.

## Controls observed

- Inspected public app tables have RLS enabled. User workspace, chat, docs, notes, tasks, projects and expenses use owner-bound policies.
- Private document bucket uses user-folder path policies.
- Bank SMS and WhatsApp link-code tables deny direct browser-role access.
- Push subscription/delivery tables revoke direct browser-role privileges for service-side processing.
- Password hashing is handled by Supabase Auth; One does not implement MD5/SHA password storage.
- Supabase JS session persists in browser-managed storage, not an HttpOnly cookie. Same-origin JavaScript can access it.
- Workspace data and document blobs remain cached in localStorage/IndexedDB for offline use. These are script-accessible; removing PII from browser storage requires a separate offline-storage redesign.
- No first-party cookie write was found in inspected app code.

## Changes made

1. Removed raw error objects/provider response details from console diagnostics in audited JS/TS paths.
2. Removed Android SMS sync exception details from logs.
3. Added a Settings privacy disclosure and linked this data-flow map.
4. Added signed-in profile-menu account deletion with confirmation dialog and typed `DELETE`.
5. Added and deployed `account-delete` Edge Function: verifies caller, requires explicit confirmation, recursively removes private document objects, deletes legacy WhatsApp processed-message rows/profile rows, revokes sessions, then deletes Auth user so owner-bound rows cascade.
6. Added account-scoped browser cleanup for workspace snapshot, pending sync metadata and linked original document blobs.
7. Redeployed AI, document JSON, push and account deletion Edge Functions with redacted diagnostics.

## Known gaps — not claimed as fixed

- localStorage/IndexedDB still contain workspace data for offline operation; same-origin scripts can access it.
- Browser auth session is not HttpOnly-cookie based.
- Provider infrastructure may retain IP/device/request logs under provider policies.
- Account deletion has not been tested end-to-end with a disposable account containing files, chat, workspace and push subscription. Test before relying on it for production deletion requests.
- User-downloaded exports/backups and copies held by external AI/provider systems are not erased by account deletion.
- `bank-sms-sync` server source is not checked into this repository; only Android payload and database schema were reviewed.
- WhatsApp tables exist, but matching active runtime integration was not located.
- Supabase Security Advisor flagged RLS-enabled service-only tables `one_push_deliveries` and `one_push_server_config` as having no policies. Browser-role privileges are revoked, which is intentional. Advisor also flagged anonymous-sign-in role semantics; verify whether anonymous Auth is intended before changing those policies because AI currently creates anonymous sessions.
- This is not a full Bearer/SAST run or formal privacy/legal assessment.

## Verification still required

1. Test account deletion using a disposable account; verify no rows remain and its Storage folder is empty.
2. Confirm Supabase Auth and Google OAuth retention/consent settings.
3. Decide whether offline browser caching is acceptable; if not, redesign it.
4. Review Gemini and push-provider retention/region settings.
5. Audit deployed `bank-sms-sync` and WhatsApp integration separately.
