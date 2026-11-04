# One — Personal Assistant

One is a lightweight, browser-based personal workspace and installable web app (PWA) for anyone. It helps people organize notes, tasks, projects, expenses, personal knowledge, documents, and AI-assisted answers—whether for everyday life, work, learning, or personal goals.

## Run locally

1. Clone or download this repository.
2. Open the project with VS Code and start a local static server (for example, Live Server).
3. Visit the local URL it provides. Avoid opening `index.html` as a `file://` URL; service workers and install features require a secure context such as localhost or HTTPS.

No build step is currently required; this is a static HTML/CSS/JavaScript app.

## Features

- Notes, tasks, projects, expenses, and workspace data.
- Local browser persistence with a last-good snapshot.
- Optional Supabase Auth/profile-backed workspace sync (requires valid project configuration and matching database policies).
- JSON workspace export and validated restore with a pre-restore safety snapshot.
- Ask My Brain: grounded Gemini AI answers from relevant notes, tasks, projects, personal memory, study history, Money & Udhaar, and uploaded PDFs/images. Answers include allowed source labels; deterministic local task/money actions and lexical fallback remain available.
- PDF text extraction, OCR for images and scanned PDF pages (English/Hindi attempt with English fallback), plus original PDF/image preservation in browser IndexedDB for supported visual analysis. Uploads are limited to 12 MB and 100 PDF pages; smaller files are sent inline to Gemini.
- Responsive layout and PWA install/service-worker support.

## AI setup (one-time)

Ask My Brain uses the existing Supabase Edge Function `student-brain-ai` and Gemini 3.5 Flash-Lite. The Gemini key is stored only as a Supabase Function secret; it is not committed to GitHub or sent to the browser.

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Open the [Student Brain Supabase Function secrets](https://supabase.com/dashboard/project/tcthrfpkydcmenxwajfg/functions/secrets) page. Add a secret named `GEMINI_API_KEY` with the Google AI Studio key as its value, then save it.
3. Open [Supabase Auth Providers](https://supabase.com/dashboard/project/tcthrfpkydcmenxwajfg/auth/providers) and enable **Anonymous Sign-Ins**. The app creates a persistent anonymous session; students do not need to enter an email or password.
4. Hard-refresh the website and ask a question about a saved note or upload. If the function reports missing configuration, recheck the secret name exactly as `GEMINI_API_KEY`.

The deployed function source is mirrored at `supabase/functions/student-brain-ai/index.ts`. The live function is deployed separately in Supabase; pushing this source file to GitHub does not deploy it automatically.

## Data and privacy

- Browser storage is not a guaranteed backup. Export a JSON backup regularly and before testing restore, clearing data, or changing browsers/devices.
- Cloud sync depends on Supabase availability, authentication state, schema, and Row Level Security (RLS). A successful code commit does not verify your project's policies.
- Extracted text is stored with workspace data; original uploaded PDFs/images are stored in that browser's IndexedDB and are not included in JSON workspace backups. When Ask My Brain needs them, relevant excerpts or eligible original files are sent to the Supabase Edge Function and Google Gemini. Do not upload sensitive documents unless comfortable with Google's Gemini API data-use terms.
- The app currently uses a public Supabase publishable/anon key in the client. This key is not a secret; **RLS and least-privilege policies are essential**. Never put a Supabase service-role key in frontend code.
- Do not treat this MVP as a production-grade secure document vault.

## Deploy

This repository can be hosted as a static site on GitHub Pages or another HTTPS static host.

1. Push the source to the intended branch.
2. In GitHub, open **Settings → Pages** and select the correct deployment source/branch (or the configured Actions workflow).
3. Wait for the Pages deployment to finish, then open the published HTTPS URL.
4. Test a fresh browser session and a mobile viewport. Verify note creation, refresh persistence, file extraction, Ask My Brain AI replies, file-specific Ask AI, source labels, anonymous Supabase session, backup export/restore, and cloud sync if configured.
5. If the PWA still shows old assets after deployment, update the service-worker cache version in `service-worker.js` and redeploy. Then close/reopen the installed app or refresh the browser.

### Deployment checklist

- [ ] Site is served over HTTPS.
- [ ] Supabase URL and publishable key point to the intended project.
- [ ] `profiles` table schema and RLS policies are verified for the authenticated user.
- [ ] Test cloud sync and offline/local behavior separately.
- [ ] Export a backup before restoring or clearing data.
- [ ] Confirm PDF.js/Tesseract CDN assets load on the target network.
- [ ] Check mobile layout, console errors, and service-worker update behavior.

## Current limitations

- Ask My Brain calls the Gemini 3.5 Flash-Lite API through a Supabase Edge Function. Free-tier quotas can be exhausted; local search/actions remain as fallback. Google states free-tier content may be used to improve products, so avoid sensitive uploads.
- OCR quality depends on scan clarity, language data, and device/network performance.
- Cloud merge/conflict resolution across simultaneous devices is not a complete sync engine.
- No guaranteed server-side backup, scheduled reminders, WhatsApp integration, or production file-storage pipeline.
