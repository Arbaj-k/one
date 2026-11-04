# Supabase cloud foundation migration

Apply `202611050002_cloud_data_foundation.sql` in the Supabase SQL Editor after the existing user profile migration. It creates:

- `user_workspaces`: one JSON workspace snapshot per authenticated user (single canonical snapshot, not duplicate tables per note/task).
- `ai_chat_messages`: user-owned conversation messages.
- `user_documents`: file metadata and extracted text.
- Private Storage bucket `one-user-documents`, with object paths beginning with the authenticated user's UUID.

Every table has RLS enabled and owner-scoped policies. Anonymous access is revoked. Storage object policies enforce the first path segment as the authenticated user's UUID. The bucket is private and has a 12 MiB upload limit for PDF/JPEG/PNG/WebP.

**Important:** this migration only establishes the database/security foundation. It does not enable app sync, upload documents, or write chat history. Keep local-first behavior until the schema is applied and RLS is tested using two separate authenticated accounts. Never use a service-role key in the browser. Export a local backup before any migration or cloud-sync experiment.
