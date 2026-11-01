# Student Brain MVP

A browser-based functional prototype for a student personal workspace.

## Run it
1. Extract `student-brain-mvp.zip`.
2. Open `index.html` in a modern browser, or use VS Code with the Live Server extension.
3. Notes, tasks, projects, expenses and chat history are saved in this browser's localStorage.

## What works
- Create/edit/delete notes and search note content.
- Create/edit/delete/complete planner tasks and filter open/overdue/completed.
- Create/edit/delete projects.
- Create/edit/delete expense entries and calculate totals from saved records.
- Demo Ask AI searches your own saved notes and shows source titles; this is keyword retrieval, not a real LLM.
- Export data as JSON and clear local data.
- Responsive desktop and mobile navigation.

## Important limitations
This is a local MVP prototype, not production SaaS yet. It has no authentication, cloud database/sync, real AI model, PDF text extraction, WhatsApp integration, or delivered reminders. Local browser storage is not a secure backup and may be cleared by browser settings. Do not store sensitive personal data in this prototype.

## Next production steps
1. Add Supabase Auth and Postgres with row-level security.
2. Store files privately and process PDFs with validated server-side extraction.
3. Add server-side AI provider integration with source-grounded retrieval and rate limits.
4. Add durable reminder scheduling and optional official WhatsApp Cloud API integration.
5. Test authorization, deletion, backup and restore before public launch.
