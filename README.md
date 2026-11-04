# One — Your Personal AI Assistant

One is a general-purpose personal AI assistant and lightweight, installable web workspace for everyone—not only students or college communities. It helps people manage everyday life, work, learning, and personal goals in one place.

## Run locally

1. Clone or download this repository.
2. Open the project with VS Code and start a local static server (for example, Live Server).
3. Visit the local URL it provides. Avoid opening `index.html` as a `file://` URL; service workers and install features require a secure context such as localhost or HTTPS.

No build step is currently required; this is a static HTML/CSS/JavaScript app.

## Features

- Notes, tasks, projects, expenses, personal memory, and workspace data.
- Local browser persistence with a last-good snapshot.
- Account authentication and a planned/optional Supabase cloud workspace foundation.
- JSON workspace export and validated restore with a pre-restore safety snapshot.
- Ask AI: grounded answers from relevant saved notes, tasks, projects, personal memory, learning history, money records, and uploaded PDFs/images.
- Personal knowledge and document uploads, including PDF text extraction and OCR for images and scanned PDF pages.
- Everyday planning and learning tools; study workflows are optional features rather than the app's audience or identity.
- Responsive layout and PWA install/service-worker support.

## AI setup

Ask AI uses the configured Supabase Edge Function and Gemini model. The Gemini API key belongs in Supabase Function secrets only; never commit it or expose it in browser code.

The live Supabase function is deployed separately. Pushing its source file to GitHub does not deploy it automatically.

## Data and privacy

- Browser storage is not a guaranteed backup. Export a JSON backup regularly and before testing restore, clearing data, or changing browsers/devices.
- Cloud sync depends on Supabase availability, authentication state, schema, and Row Level Security (RLS). A successful code commit does not verify your project's policies or enable cloud sync.
- Extracted text and workspace records may be stored locally. Original uploaded files may remain in this browser's IndexedDB and may not be included in JSON workspace backups.
- AI requests may send relevant excerpts or eligible original files to connected AI services. Avoid sensitive uploads unless comfortable with the provider's data-use terms.
- The app uses a public Supabase publishable/anon key in the client. This key is not a secret; **RLS and least-privilege policies are essential**. Never put a Supabase service-role key in frontend code.
- Do not treat this MVP as a production-grade secure document vault.

## Deploy

This repository can be hosted as a static site on GitHub Pages or another HTTPS static host.

1. Push the source to the intended branch.
2. In GitHub, open **Settings → Pages** and select the correct deployment source/branch (or configured Actions workflow).
3. Wait for the Pages deployment to finish, then open the published HTTPS URL.
4. Test a fresh browser session, mobile layout, local persistence, Ask AI, backup export/restore, and cloud behavior if configured.
5. If the PWA still shows old assets after deployment, update the service-worker cache version in `service-worker.js` and redeploy.

## Current limitations

- AI depends on configured services and free-tier quotas; local search and actions may remain available as fallback.
- OCR quality depends on scan clarity, language data, device, and network performance.
- Cross-device cloud merge/conflict resolution is not a complete sync engine.
- No guaranteed server-side backup, scheduled reminders, or production file-storage pipeline.
