-- Extend the existing private One document bucket for HEIC/HEIF originals.
-- Safe to re-run; existing objects and owner-scoped Storage policies are unchanged.
begin;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]
where id = 'one-user-documents';

commit;
