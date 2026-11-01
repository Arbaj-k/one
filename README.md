# Student Brain

Student Brain is a lightweight, browser-based student workspace and installable web app (PWA). It includes notes, tasks/planner, projects, expenses, study history, file text extraction, and source-based Ask My Brain search.

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
- Ask My Brain: local retrieval from note text and extracted file text, with source labels. It is **not** an LLM and does not generate answers beyond retrieved source text.
- PDF text extraction and image OCR (English/Hindi attempt with English fallback); file size and PDF page limits apply.
- Responsive layout and PWA install/service-worker support.

## Data and privacy

- Browser storage is not a guaranteed backup. Export a JSON backup regularly and before testing restore, clearing data, or changing browsers/devices.
- Cloud sync depends on Supabase availability, authentication state, schema, and Row Level Security (RLS). A successful code commit does not verify your project's policies.
- Files are processed in the browser for text extraction. Extracted text is stored with workspace data; review your privacy needs before uploading sensitive material.
- The app currently uses a public Supabase publishable/anon key in the client. This key is not a secret; **RLS and least-privilege policies are essential**. Never put a Supabase service-role key in frontend code.
- Do not treat this MVP as a production-grade secure document vault.

## Deploy

This repository can be hosted as a static site on GitHub Pages or another HTTPS static host.

1. Push the source to the intended branch.
2. In GitHub, open **Settings → Pages** and select the correct deployment source/branch (or the configured Actions workflow).
3. Wait for the Pages deployment to finish, then open the published HTTPS URL.
4. Test a fresh browser session and a mobile viewport. Verify note creation, refresh persistence, file extraction, Ask My Brain source labels, backup export/restore, and cloud sync if configured.
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

- Ask My Brain uses local lexical matching/retrieval; it is not semantic search or a connected AI model.
- OCR quality depends on scan clarity, language data, and device/network performance.
- Cloud merge/conflict resolution across simultaneous devices is not a complete sync engine.
- No guaranteed server-side backup, scheduled reminders, WhatsApp integration, or production file-storage pipeline.
