# Veld Archive

Veld Archive is a Cloudflare-native foundation for a trusted South African photo and video licensing marketplace.

## Implemented phases

- Editorial landing page and natural-language search interface.
- Phase 1: contributor onboarding, role-gated asset creation and metadata editing, R2 upload sessions with completion checks, explainable search, governance queues, and editorial review actions.
- Phase 2: rights-aware licence validation and checkout records, Stream webhook verification, explainability/provenance fields, community collections, takedown cases, mediation records, and provider-neutral integration adapters.
- Phase 3: privacy-conscious analytics, contributor/buyer reporting endpoints, append-only signed audit exports, residency-aware verification cases, DR replication, observability, and payout/DAM adapter contracts.
- D1 schema for contributors, organisations, assets, licences, ledger entries, analytics, rights cases, audit events, and upload sessions.
- Worker API for search, onboarding, asset ingestion, governance, checkout validation, analytics, rights cases, verification, Stream webhooks, upload completion, and server-side Turnstile verification.
- Append-only audit API with SHA-256 hash chaining, Ed25519 signatures, immutable D1 triggers, R2 event objects, and signed legal-dispute exports.
- Residency-aware contributor verification cases with KYC-provider webhook handling, sanctions/PEP/adverse-media result capture, beneficial-owner checks, document hashes, and retention metadata.
- R2, D1, and static-assets bindings prepared in `wrangler.jsonc`.
- Asynchronous R2 geographic DR replication, D1 export backups, structured logs, traces, custom metrics, Stream webhooks, and upload chaos testing.
- South African taxonomy and explicitly marked demo seed records.
- Responsive UI with asset detail modal, verification states, contributor and buyer workspaces, governance review, insights, community/collections, and rights-aware language.
- Authenticated buyer/contributor lightboxes with private collection creation, idempotent asset saves, removal, deletion, tenant isolation, and audit events.
- Tenant-scoped saved searches with daily/weekly in-app alerts, privacy-thresholded trending searches, and explainable recommendations derived only from explicit saved searches and lightboxes.
- Curator metadata governance pipeline: ingestion → AI tagging → curator correction → approval, with auditable metadata events.
- Pre-checkout licence rules that cross-check approval, rights scope, and contributor model/property releases; invalid transactions return HTTP 422.
- Seller listings capture an explicit artist licence (custom terms or an established licence with proof URL/version); the seller remains responsible for rights and enforcement.
- Explainable search results showing match evidence, metadata fields used, separate confidence signals, and human verification status.
- Confidence-prioritized editorial review queue with server-side metadata safety checks that reject stereotype or identity-inference labels.
- Paystack marketplace-split settlement for approved artists (with legacy payout adapters retained behind explicit provider configuration). The artist keeps copyright; WeDoCMS is the listing and checkout intermediary.
- Optional verification-document OCR using Cloudflare Workers AI's `@cf/moondream/moondream3.1-9B-A2B`; OCR output is assistive, masks full identity/bank numbers, and always requires human/KYC-provider review.
- Photo AI pipeline: image upload → queued Workers AI visual metadata/OCR → seller/editor correction and approval → one-time embedding → Vectorize upsert. Buyer searches query the stored vectors and never OCR-scan the repository.
- Idempotent `photo_ai_jobs` records, queue retries/dead-letter handling, scheduled recovery, vector deletion for rejected photos, and an admin re-index endpoint (`POST /api/admin/photo-index/rebuild`).

Visual cards render only the approved preview URL returned by the media service. When a derivative is unavailable, the UI shows an explicit unavailable state and does not fabricate or substitute a stock image. Development-only demo fallback is removed from production bundles and production API routes block seeded demo media.

## Local South African media fixtures

Run `npm run seed:demo-media` to download six real South African image/video files from Wikimedia Commons and Pixabay, apply migrations `0011_demo_media_seed.sql` and `0012_demo_media_video_source_fix.sql`, place the files in local R2, and verify the D1 records. The seed is local-only and does not write to a remote Cloudflare account. Source pages, direct download URLs, licences, and creator attribution are persisted on each seeded asset. Two people-containing images intentionally remain in `needs_review` and `editorial_only` so the governance flow can be tested.

## Local development

```powershell
npm install
npm run dev
```

Cloudflare binding types are generated in `worker-configuration.d.ts` and committed with the project so clean CI checkouts can typecheck without a network-dependent generation step. After changing `wrangler.jsonc`, refresh them with `npx wrangler types` and commit the updated file.

The frontend runs on Vite. To run the Worker API locally after installing Wrangler and configuring a D1 database, use:

```powershell
npm run worker:dev
```

`npm run worker:deploy` is production-only and refuses to deploy the root development bindings. It runs the production bundle gate and requires a dedicated `env.production` block with `APP_ENV=production` and no demo, localhost, or placeholder values. Use `npm run worker:deploy:development` only for an intentional non-production Worker.

### Auth0 and Supabase identity

Auth0 and Supabase can run together. Configure an Auth0 SPA application with Authorization Code + PKCE and a custom API that issues RS256 access tokens. Set `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, and the optional `VITE_AUTH0_ORGANIZATION` for the frontend. Set `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_ROLES_CLAIM` as Worker variables. The tenant Management API (`https://<tenant>/api/v2/`) is not the application API audience and must not be requested by the SPA. Register the deployed app URL as an allowed callback, logout, and web-origin URL in Auth0.

For Supabase, set `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_ANON_KEY` in the SPA environment, then set `SUPABASE_URL`, `AUTH_PROVIDER=both`, and either an explicit `SUPABASE_JWKS_URL` for asymmetric signing or the `SUPABASE_JWT_SECRET` Wrangler secret for this project's current legacy HS256 signing. Supabase email/password signup, email confirmation, login, phone OTP signup/login, and session refresh are handled by the Supabase client; the Worker verifies the Supabase JWT and exchanges it for the same application session. Phone-only identities receive a stable internal contact address until a real contact email is collected by a later account workflow. The anon key is safe for browser use; never put a Supabase service-role key in the client or Worker.

The Worker verifies external tokens against the configured issuer/JWKS, retrieves the Auth0 `openid profile email` UserInfo profile when configured, and creates the existing HttpOnly session. Supabase identities are namespaced in `auth_subject` to prevent cross-provider collisions. For a single-organisation deployment, pre-provision `DEFAULT_ORGANIZATION_ID`; a browser-supplied organization ID is accepted only when it matches a signed claim or that configured default. Keep `AUTH_ALLOW_ORG_PROVISIONING=false` in production. The identity provider owns sign-in; D1 remains the source of truth for application roles, organization memberships, credits, licence ownership, ledger entries, and payment state. D1 `auth_security_events` records provider, outcome, subject hash context, and bounded request metadata; high-risk events are also emitted to Worker Logs and Analytics Engine.

Apply the initial database migration with Wrangler after replacing the D1 ID in `wrangler.jsonc`:

```powershell
wrangler d1 migrations apply veld-archive --local
```

Apply all migrations, including the governance schema, with:

```powershell
wrangler d1 migrations apply veld-archive --remote
```

The curator workspace is available through **Governance** in the top navigation. The API surface is `GET /api/governance/assets`, `POST /api/governance/assets/:id/action`, `POST /api/checkout/validate`, and `POST /api/checkout`.

Community and rights-resolution endpoints are `GET /api/community/overview`, `POST /api/rights/takedown`, `GET /api/rights/cases`, and `POST /api/rights/cases/:id/messages`. Migration `0003_community_resolution.sql` creates the forums, showcases, featured collections, takedown cases, mediation sessions, and mediation messages.

Personal lightbox endpoints are `GET /api/lightboxes`, `POST /api/lightboxes`, `POST /api/lightboxes/:id/assets`, `DELETE /api/lightboxes/:id/assets/:assetId`, and `DELETE /api/lightboxes/:id`. Migration `0013_user_lightboxes.sql` stores tenant-scoped collections per authenticated organisation member; the current UI defaults to private collections. Mutations require the session CSRF token.

Discovery endpoints are `GET /api/discovery`, `POST /api/saved-searches`, `PATCH /api/saved-searches/:id`, and `DELETE /api/saved-searches/:id`. Migration `0015_personalized_discovery.sql` stores explicit search preferences and alert cadence. The scheduled Worker creates in-app notifications for new matches; trending queries require an aggregate privacy threshold, and recommendations disclose the matching metadata signal.

The CI workflow runs typecheck, tests, production build, and a Playwright + axe-core WCAG 2.2 AA scan against the archive landing page and resolution workspace:

```powershell
npm run build
npm run release:check
npx playwright install chromium
npm run test:a11y
```

### Desktop Postman/Newman sweep

The checked-in `npm run test:postman` collection exercises the production API,
Supabase signup and identity-exchange boundaries, and the main desktop web
shell. It discovers every `/api` route from the Worker source and loads desktop
Vite values from the root `.env.local` (`VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`), with the mobile environment as a fallback.
Publishable keys are used only in memory and are never printed.

```powershell
$env:POSTMAN_DESKTOP_URL = "https://veld-archive.pages.dev"
$env:POSTMAN_BASE_URL = "https://veld-archive-api.blewisorlando.workers.dev"
npm run test:postman
```

Use `POSTMAN_SKIP_SUPABASE=true` when the Supabase signup rate limit is active;
the desktop shell and all API routes remain covered.

Apply subsequent migrations in order as well; `0004_explainability_safety.sql` adds persisted metadata provenance and review status. Validate the chain with `npx wrangler d1 migrations list veld-archive --local`.

## Cloudflare setup

1. Create a D1 database called `veld-archive` and replace `database_id` in `wrangler.jsonc`.
2. Create the R2 bucket `veld-archive-media`.
3. Create `veld-archive-audit-za` and `veld-archive-kyc-za` under the approved South African residency policy. Create `veld-archive-audit-eu` and `veld-archive-kyc-eu` with the `eu` R2 jurisdiction for EU subjects. R2 jurisdiction is immutable after bucket creation; confirm the account's data-location controls before production.
4. Generate an Ed25519 signing keypair and store the private/public JWKs as Worker secrets: `wrangler secret put AUDIT_SIGNING_PRIVATE_JWK`, `wrangler secret put AUDIT_SIGNING_PUBLIC_JWK`, and `wrangler secret put KYC_WEBHOOK_SECRET`.
5. For seller onboarding, create one Didit KYC workflow (individual/sole proprietor) and one KYB workflow (registered company), configure phone/email, ID/passport, liveness and any risk checks required by your payment/legal classification, then store `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_KYC_WORKFLOW_ID`, and `DIDIT_KYB_WORKFLOW_ID`. Register `POST /api/webhooks/didit` as the Didit webhook destination. Didit returns a hosted URL; the Worker stores only the session ID, status, and provider reference.
5. Turnstile is optional until high-risk seller, rights, or upload actions are enabled. When those actions are enabled, create separate widgets for the development and production hostnames, store the server secret with `wrangler secret put TURNSTILE_SECRET`, and replace the development `TURNSTILE_HOSTNAMES` value for production.
6. For browser-direct R2 uploads, configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` as Worker secrets/vars according to your deployment policy. The API then issues a short-lived presigned PUT URL.
7. Provision the DR buckets and R2 event queue with `./scripts/provision-dr.ps1`.
8. Configure `STREAM_WEBHOOK_SECRET` and `CHAOS_TEST_TOKEN` as Worker secrets.
9. Configure the KYC provider to POST only signed, metadata-only decisions to `/api/webhooks/kyc`; never send raw identity documents through the audit endpoint. The webhook uses HMAC-SHA256 in `x-kyc-signature`.
10. Create the photo Vectorize index with the same embedding preset used by the Worker: `wrangler vectorize create veld-archive-photo-index --preset @cf/baai/bge-base-en-v1.5`. The committed config already binds it as `PHOTO_INDEX`.
11. Create the queues before deployment: `wrangler queues create veld-archive-photo-enrichment` and `wrangler queues create veld-archive-photo-enrichment-dlq`. The committed config binds the producer and consumer.
12. The committed production config sends image-to-text enrichment to the authenticated local Qwen model through `veld-vision.mutatiostrategic.io`; `REMOTE_VISION_TOKEN` remains a Worker secret. Workers AI is retained for `PHOTO_EMBEDDING_MODEL`, which must remain dimension-compatible with Vectorize. Missing vision, embedding, or tunnel connectivity is treated as a retryable job failure, not a buyer-search scan.
13. Keep verification-document OCR disabled until intentionally enabled. Set `OCR_ENABLED=true` only for the intended environment. The admin-only endpoint is `POST /api/verification/documents/:documentId/ocr`; it verifies the registered SHA-256 before inference and never changes the KYC case decision.
14. Apply `0006_photo_ai_search.sql`, then run `npm run build` before `npm run worker:deploy`.

## Audit endpoints

- `POST /api/audit/events` appends an event. Send `x-user-id`, `x-user-role`, and `x-residency-region`; event data is redacted for common identity fields before signing.
- `GET /api/audit/events/:streamId?residencyRegion=za` returns events with hash/signature verification results.
- `POST /api/audit/exports` creates a signed JSON legal export for an admin/service identity; `GET /api/audit/exports/:id` downloads it from the matching residency bucket.
- `POST /api/verification/cases` starts a contributor verification case; documents are represented by hashes and provider references, not copied into the audit trail.

An audit event is accepted only after its signed R2 object is written and a conditional D1 chain-head insert succeeds. D1 triggers reject event updates/deletes. Operators should additionally enforce least-privilege R2/D1 roles, retention policy, key rotation, access reviews, and an independent backup/escrow process for evidentiary use.

## Production activation still required

The code is deployable as a staged foundation, but these external controls must be configured before accepting real users, media, or money:

- Configure the Auth0 Organization tenant values and map its organization IDs to the provisioned D1 `organizations` rows. The Worker now verifies Auth0 RS256/JWKS tokens and exchanges them for the existing HttpOnly session; keep the development login disabled in production.
- Configure R2 S3 credentials for presigned PUTs, private preview objects, CORS, media-processing workers/queues, and Cloudflare Images transformations.
- Configure Cloudflare Stream direct creator uploads, signed playback, and provider status mapping. Webhook verification is implemented; provider provisioning is not.
- Optionally provision the Workers AI binding, the `veld-archive-photo-index` Vectorize index, and both photo queues. Search remains deterministic without AI; when enabled, it embeds only the buyer's query and retrieves approved photo IDs from Vectorize, while image OCR/vision runs only from upload/approval jobs.
- OCR is separately opt-in. It stays unavailable with a `503` response until both `OCR_ENABLED=true` and an `AI` binding are configured. The model is pinned by `OCR_MODEL`; callers cannot select arbitrary models.
- Configure Paystack checkout and a verified artist subaccount. The payment session sends the agreed percentage split to Paystack, records the allocation, and only activates a licence after the signed webhook is reconciled. See `docs/marketplace-terms.md` and `IMPORTANT.md`; no fake payment is treated as paid.
- Configure Turnstile, audit signing keys, KYC provider secrets, WAF/rate limits, CSP, and production environment-specific bindings.
- As an admin, call `GET /api/ops/readiness` after provisioning. Do not promote the release until every check reports `ready: true`; WAF, key rotation, and restore drills require dated attestations after live verification.

Never use the demo user header or seeded demo records as production identity or evidence. The production search/media routes reject demo records, and the release gate removes development fallback content from the built client.

## Provider abstraction layer

Integration code lives under `src/integrations`. Application services depend on the `PayoutProvider` and `DamProviderAdapter` interfaces and select implementations through registries, so changing vendors does not change payout or asset domain models.

Zoho ecosystem handoffs are available through the same boundary. `GET /api/integrations/zoho/status` reports configured app capabilities; approved campaigns can be handed to Zoho Social through Zoho Flow with rights metadata and public preview URLs, campaigns can be upserted into Zoho CRM v8 using a configured external field, and editorial rights cases can be handed to Zoho Desk. Optional Zoho Campaigns and Analytics Flow payloads are supported by the adapter. See `docs/zoho-integrations.md` for scopes, secrets, Flow setup, and the rule that a webhook response proves only handoff—not publication, delivery, or case resolution.

Shared application rules are exposed through the stateless `archiveDomain` object in `src/shared.ts`. Browser and Worker code should use that facade for matching, confidence, formatting, and licence validation rather than importing each rule individually. External provider construction is owned by `IntegrationContainer` in `src/integrations/index.ts`; route handlers consume its provider registries and should not instantiate vendor adapters directly. Keep this boundary narrow—feature objects are preferred over a single global service object so modules remain cohesive and testable.

Payout adapters include Stripe Connect, configurable South African bank, mobile-money, and SEPA transfer implementations. The latter three accept an injected endpoint and credentials because bank and gateway payloads vary by institution.

DAM adapters include AEM Assets and Bynder. Both normalize source assets and metadata while keeping upload protocol details inside the adapter. Add a new vendor by implementing the relevant interface and registering it at the composition root; do not import vendor SDKs into domain code.

See [disaster recovery](docs/disaster-recovery.md), [observability](docs/observability.md), [budget alerts](docs/budget-alerts.md), and [launch checklist](docs/launch-checklist.md) for the production handoff.

Security and operational controls are documented in [security operations](docs/security-operations.md). Run `npm run test:migrations`, `npm run test:local-smoke`, and `npm run test:payments` against a configured Worker before promoting a release.
