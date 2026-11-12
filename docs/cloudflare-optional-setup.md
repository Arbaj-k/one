# Optional Cloudflare layer for One

One continues to use GitHub + GitHub Pages + Supabase as its primary stack. This folder documents optional Cloudflare services; nothing here replaces Supabase Auth, Postgres, RLS, Edge Functions, or the current GitHub Pages deployment.

## 1. Cloudflare Pages (optional second deployment)

1. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git**.
2. Connect `Arbaj-k/one` and select `main`.
3. Framework preset: **None**.
4. Build command: leave empty.
5. Build output directory: `/` (repository root).
6. Deploy and test the generated `*.pages.dev` URL before attaching a custom domain.

This repository is still deployed through GitHub Pages. A Cloudflare Pages deployment is an optional parallel deployment; do not change the production URL or DNS until the Pages copy has been fully tested.

The root `_headers` file adds browser security headers on Cloudflare Pages. GitHub Pages does not process Cloudflare Pages `_headers` rules, so these headers do not alter the current GitHub Pages deployment.

## 2. Cloudflare Web Analytics

Enable Web Analytics for the Pages hostname in the Cloudflare dashboard. Cloudflare will provide a site token and tracking snippet. Add that exact snippet to `index.html` only after the hostname is selected and the token is available. Do not invent or commit an empty/fake token.

The existing `analytics.js` is One's feature-usage analytics and is separate from Cloudflare Web Analytics.

## 3. Cloudflare Turnstile (signup / public-form bot protection)

Turnstile is not enabled until both a site key and a secret key exist.

1. Create a Turnstile widget for the exact production hostname(s).
2. Keep the **site key** in public frontend configuration.
3. Store the **secret key** only as a Supabase Edge Function secret (or another trusted server-side secret).
4. Verify each token server-side using Cloudflare's Siteverify API before allowing signup or form submission.
5. Reject missing, expired, replayed, or invalid tokens. Never treat a frontend-only widget check as protection.

Do not paste the secret key into `auth.js`, HTML, GitHub, or chat.

## 4. Custom domain and DNS

A custom domain is optional. If one is purchased, add it in Cloudflare Pages and follow the exact DNS records Cloudflare provides. Keep GitHub Pages' existing domain and DNS unchanged until the Cloudflare hostname is verified and tested. Do not switch nameservers or delete existing DNS records blindly.

## 5. What remains on Supabase

- Supabase Auth remains the identity provider.
- Supabase Postgres and RLS remain the source of truth for application data.
- Supabase Edge Functions remain the server-side AI/API layer.
- Existing Supabase Storage remains the file store unless a measured need justifies an R2 migration.

Cloudflare D1 is intentionally not added because it would duplicate the existing Postgres database. Workers and R2 can be added later for a concrete workload, not just to increase the number of services.

## Security notes

- Never expose Supabase service-role keys, Gemini keys, Cloudflare API tokens, or Turnstile secrets in browser code.
- Keep RLS enabled and test cross-account access with separate users.
- Test OAuth, file upload, PWA installation/update, and mobile navigation on the Pages preview before changing any production DNS.
