# Production launch checklist

## Identity and tenancy

- [x] Implement dual-provider Auth0/Supabase sign-in, signup, verified JWT exchange, and HttpOnly application sessions; configure the selected provider values and callback URLs before launch.
- [x] Replace `x-demo-user-id` with verified session claims in application code.
- [x] Enforce organisation membership and role permissions on every private route in the Worker.
- [ ] Test account deletion, export, email verification, password reset, and MFA readiness.

## Media and search

- [x] Keep the catalogue boundary explicit: Stockvel supports photography and video, not audio or music.
- [x] Add tenant-scoped saved searches, daily/weekly in-app alerts, privacy-thresholded trending searches, and explainable recommendations based only on explicit saved searches/lightboxes.
- [x] Fail closed on demo media in production search and preview delivery; never substitute fabricated media when a licensed preview is unavailable.
- [x] Run `npm run release:check` against the production bundle and block any demo identifier, fallback metadata, placeholder configuration, or placeholder-preview copy.
- [x] Create private R2, DR, audit, and jurisdiction-specific KYC buckets.
- [ ] Configure R2 CORS and short-lived presigned PUT credentials.
- [ ] Configure media-processing queues, image transformations, and Stream direct uploads.
- [ ] Configure signed Stream playback and webhook delivery.
- [x] Provision Workers AI and Vectorize for background photo enrichment and indexing; keep live buyer search metadata-only until a separately approved semantic-search release.
- [ ] Replace all demo visual cards with approved, licensed media.
- [ ] Configure Image Delivery variants (`thumb`, `card`, `preview`, `download`) and verify crop, format negotiation, cache policy, and private-original access.
- [ ] Configure Stream direct uploads, signed playback, allowed origins, and the signed `/api/webhooks/stream` callback; verify a video progresses from processing to editorial review.

## Marketplace growth and lifecycle

- [ ] Review and publish opt-in creator profiles, portfolio collections, canonical creator URLs, and generated SEO/Open Graph metadata.
- [ ] Verify contributor discovery, more-from-artist, collection navigation, views/saves/downloads, conversion rate, and licence download history with a staged purchase.
- [ ] Approve the standard, enhanced, editorial, and custom licence terms; verify receipt and evidence hashes can be exported and independently checked.
- [ ] Configure the identity-provider account portal and test email verification, password reset, MFA, export, deletion recovery window, notifications, and organization invitations.

## Rights and money

- [ ] Configure Turnstile site keys and server secret for all high-risk actions.
- [x] Implement payment webhook deduplication, idempotency, refund, chargeback, and reconciliation paths.
- [ ] Obtain written Paystack confirmation of marketplace/split settlement, fee bearer, split basis, refunds, chargebacks, reserves, KYC and any PASA/FIC obligations; verify a seller Paystack subaccount and test the configured percentage split (for example 60% artist / 40% WeDoCMS).
- [ ] Publish approved `seller-marketplace-v2`, `buyer-marketplace-v2`, and `payment-split-v2` terms; confirm onboarding and checkout acceptance hashes are retained.
- [ ] Upload and review model/property releases using the configured KYC/document provider.

## Security and operations

- [ ] Set production WAF rules, edge rate limits, secure-cookie domain policy, origin allowlists, and secret rotation.
- [x] Add Worker-side CORS allowlisting, CSP/security headers, CSRF validation, D1 rate limits, upload quotas, and production fail-closed scanning.
- [x] Add the admin-only `GET /api/ops/readiness` gate for identity, R2/scanning, Stream, payments, KYC, audit keys, Vectorize/AI/queues, demo-row removal, migrations, bound resources, and dated WAF/key-rotation/restore attestations.
- [ ] Store Ed25519 audit JWKs and test signed export verification offline.
- [x] Run migrations against staging, then production, with a D1 export backup.
- [ ] Verify DR replication, restore procedure, queue dead-letter handling, and observability alerts.
- [x] Run typecheck, unit/integration tests, build, accessibility review, authenticated smoke, penetration smoke, DR restore smoke, migration, and payment reconciliation tests locally.

No unchecked item is satisfied by source code, a dry run, or a checkbox alone. Close it only after the production resource/provider is provisioned and its result is recorded in the readiness endpoint or release evidence. A release is blocked while `ready` is false.

## Live Cloudflare audit — 2026-08-16

Live Cloudflare changes and checks on 2026-08-16:

- Present: `veld-archive-media`, `veld-archive-media-dr`, `veld-archive-backups`, `veld-archive-backups-dr`, `veld-archive-audit-za`, `veld-archive-audit-eu` (EU jurisdiction), `veld-archive-kyc-za`, `veld-archive-kyc-eu` (EU jurisdiction), all configured Stockvel queues, D1 `veld-archive`, and Vectorize `veld-archive-photo-index` (768 dimensions, cosine).
- D1 migrations `0013` through the current `0019` applied remotely. `0019_auth_security_events.sql` adds provider-neutral security events for D1 plus structured Worker Logs/Analytics forwarding. The legacy `saved_searches` columns were reconciled before applying `0015`; the FTS5-derived tables were excluded from the pre-migration export.
- A pre-production D1 export is stored locally under `.backups/` and uploaded to both backup buckets with a SHA-256 manifest.
- Dedicated Wrangler environment `veld-archive-api-production` is deployed at `https://veld-archive-api-production.blewisorlando.workers.dev`; `/api/health` returned HTTP 200 and `environment: production`.
- Cloudflare Secrets Store contains active `PAYSTACK_TEST_SECRET_V1` and `STREAM_WEBHOOK_SECRET_V1` secrets, and the production Worker binds both payment test secret slots and the Stream webhook slot.
- Production readiness remains intentionally fail-closed: the shared D1 still contains six demo asset rows, Supabase project values and/or complete Auth0 audience configuration still need to be supplied, scanner/KYC/audit/Turnstile attestations are absent, and `/api/ops/readiness` returns HTTP 403 without an admin session.

WAF was not changed: the deployed endpoint is on `workers.dev` (not a customer-owned zone), and the current Wrangler OAuth token lacks Rulesets write permission. A customer-owned production hostname plus refreshed Cloudflare token/API permission is required before a WAF rule can be created and verified. Auth0 similarly requires the tenant/application values or an authenticated Auth0 management session.
