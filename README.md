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
- Curator metadata governance pipeline: ingestion → AI tagging → curator correction → approval, with auditable metadata events.
- Pre-checkout licence rules that cross-check approval, rights scope, and contributor model/property releases; invalid transactions return HTTP 422.
- Explainable search results showing match evidence, metadata fields used, separate confidence signals, and human verification status.
- Confidence-prioritized editorial review queue with server-side metadata safety checks that reject stereotype or identity-inference labels.
- Vendor-neutral payout and DAM integration layer with Stripe Connect, South African bank, mobile-money, SEPA, Adobe Experience Manager, and Bynder adapters.
- Optional verification-document OCR using Cloudflare Workers AI's `@cf/moondream/moondream3.1-9B-A2B`; OCR output is assistive, masks full identity/bank numbers, and always requires human/KYC-provider review.
- Photo AI pipeline: scanned image upload → revision-pinned Workers AI description, visible-location type, category, attributes, and visible-text extraction → seller/editor correction → approval of that exact revision → D1 FTS5 + Vectorize indexing. The model never asserts country, province, city, locality, or landmark from pixels; those fields require seller metadata, EXIF, or editor evidence.
- Hybrid buyer retrieval combines D1 FTS5 lexical/structured matches with semantic Vectorize matches and human-verification weighting. Buyer searches query approved stored metadata and vectors; they never OCR-scan the repository.
- Revision/ETag-aware `photo_ai_jobs` records, retryable/permanent/validation/stale failure classes, scheduled recovery, D1 dead-letter state, revision-specific vector IDs, rejection/withdrawal deletion, provenance history, upload-time-only AI enrichment (later metadata edits are manual), admin replay for index jobs (`POST /api/admin/photo-jobs/:jobId/replay`), and re-indexing (`POST /api/admin/photo-index/rebuild`).

The visual cards are intentionally placeholder previews. They do not claim to be real photographs and should be replaced by uploaded, licensed media before production launch.

## Local South African media fixtures

Run `npm run seed:demo-media` to download six real South African image/video files from Wikimedia Commons and Pixabay, apply migrations `0011_demo_media_seed.sql` and `0012_demo_media_video_source_fix.sql`, place the files in local R2, and verify the D1 records. The seed is local-only and does not write to a remote Cloudflare account. Source pages, direct download URLs, licences, and creator attribution are persisted on each seeded asset. Two people-containing images intentionally remain in `needs_review` and `editorial_only` so the governance flow can be tested.

Run `npm run seed:test-library` after that to add exactly 100 local-only synthetic photo records to D1 and the FTS search index. The records cover cat, mountain, coast, market, road, architecture, food, wildlife, sport, and craft prompts. They intentionally have no media preview because the metadata is synthetic and must not be presented with unrelated visual evidence; the records are explicitly marked as non-licensable test fixtures. The command verifies that `cat` returns matches and `xyz` returns zero results, which exercises both the prompt search and empty state.

The remote equivalent is deliberately explicit: `npm run seed:test-library:remote`. It uploads the existing demo media fixtures to the configured Cloudflare R2 bucket and inserts the 100 test records into remote D1/FTS. Review the target account and database before using it; the records remain marked as local test fixtures and should not be used for licensing.

## Local development

```powershell
npm install
npm run dev
```

The frontend runs on Vite. To run the Worker API locally after installing Wrangler and configuring a D1 database, use:

```powershell
npm run worker:dev
```

### Deployment topology and live smoke test

The frontend and `/api/*` routes are served by the Worker configured in
`wrangler.jsonc`. The Pages project is kept as a compatibility entry point and
redirects to that Worker via `public/_redirects`; it must not be treated as a
second application runtime. Deploying `dist` as a standalone Cloudflare Pages
project without that redirect breaks the application because Pages' SPA
fallback returns `index.html` for API requests.

Deploy the Worker and its Assets binding with:

```powershell
npm run build
npm run worker:deploy
npm run test:live -- https://your-worker-host.example
```

Then publish the compatibility redirect:

```powershell
npm run pages:prepare-redirect
npx wrangler pages deploy ./dist --project-name veld-archive
```

Do not keep `_redirects` in `public/` before a Worker deploy. Vite copies
`public/` into `dist`, and Worker Assets will honor `_redirects`, causing the
Worker origin to redirect back to itself.

If a Pages hostname must remain public, route `/api/*` to this Worker (or
move the API into Pages Functions) before pointing the frontend at it. A live
check that returns `text/html` for `/api/health` is not a working deployment.

Consumer and provider contract stubs are documented in [API contract testing](docs/api-contract-testing.md). Run `npm run test:contracts:openapi` and `npm run test:contracts:consumer` without a Worker; run `npm run test:contracts:provider` against a local or configured Worker.

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

Transactional notifications are persisted in D1 and delivered through the native Cloudflare Email Service `EMAIL` binding when `EMAIL_FROM` is configured. See [transactional email setup](docs/email-service.md) for domain onboarding and secret configuration.

The CI workflow runs typecheck, tests, production build, and a Playwright + axe-core WCAG 2.2 AA scan against the archive landing page and resolution workspace:

```powershell
npm run build
npx playwright install chromium
npm run test:a11y
```

Apply subsequent migrations in order as well; `0004_explainability_safety.sql` adds persisted metadata provenance and review status. Validate the chain with `npx wrangler d1 migrations list veld-archive --local`.

## Cloudflare setup

1. Create a D1 database called `veld-archive` and replace `database_id` in `wrangler.jsonc`.
2. Create the R2 bucket `veld-archive-media`.
3. Create `veld-archive-audit-za` and `veld-archive-kyc-za` under the approved South African residency policy. Create `veld-archive-audit-eu` and `veld-archive-kyc-eu` with the `eu` R2 jurisdiction for EU subjects. R2 jurisdiction is immutable after bucket creation; confirm the account's data-location controls before production.
4. Generate an Ed25519 signing keypair and store the private/public JWKs as Worker secrets: `wrangler secret put AUDIT_SIGNING_PRIVATE_JWK`, `wrangler secret put AUDIT_SIGNING_PUBLIC_JWK`, and `wrangler secret put KYC_WEBHOOK_SECRET`.
5. Create a Turnstile widget for the development and production hostnames.
6. Store the Turnstile secret with `wrangler secret put TURNSTILE_SECRET`.
7. Replace the development `TURNSTILE_HOSTNAMES` value for production.
8. For browser-direct R2 uploads, configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` as Worker secrets/vars according to your deployment policy. The API then issues a short-lived presigned PUT URL.
9. Provision the DR buckets and R2 event queue with `./scripts/provision-dr.ps1`.
10. Configure `STREAM_WEBHOOK_SECRET` and `CHAOS_TEST_TOKEN` as Worker secrets.
11. Configure the KYC provider to POST only signed, metadata-only decisions to `/api/webhooks/kyc`; never send raw identity documents through the audit endpoint. The webhook uses HMAC-SHA256 in `x-kyc-signature`.
12. Create the photo Vectorize index with the same embedding preset used by the Worker: `wrangler vectorize create veld-archive-photo-index --preset @cf/baai/bge-base-en-v1.5`. The committed config already binds it as `PHOTO_INDEX`.
13. Create the queues before deployment: `wrangler queues create veld-archive-photo-enrichment` and `wrangler queues create veld-archive-photo-enrichment-dlq`. The committed config binds the producer and consumer.
14. The committed config includes the Workers AI binding. Run `npx wrangler types` after any binding change. `PHOTO_VISION_MODEL` controls visual metadata/OCR and `PHOTO_EMBEDDING_MODEL` must remain dimension-compatible with the Vectorize index; missing AI is treated as a retryable job failure, while the approved D1 FTS5 document remains available for keyword retrieval. `PHOTO_AI_SOURCE_ORIGIN` must point to this Worker origin with Cloudflare Image Transformations enabled: oversized private images are resized through the job-scoped internal source route before AI inference, while originals remain unchanged.
15. Keep verification-document OCR disabled until intentionally enabled. Set `OCR_ENABLED=true` only for the intended environment. The admin-only endpoint is `POST /api/verification/documents/:documentId/ocr`; it verifies the registered SHA-256 before inference and never changes the KYC case decision.
16. Apply `0006_photo_ai_search.sql` and `0013_photo_enrichment_orchestration.sql`, then run `npm run build` before `npm run worker:deploy`. During rollout, drain or replay pre-0013 photo messages because new queue envelopes include `assetRevision` and `sourceEtag`.

## Audit endpoints

- `POST /api/audit/events` appends an event. Send `x-user-id`, `x-user-role`, and `x-residency-region`; event data is redacted for common identity fields before signing.
- `GET /api/audit/events/:streamId?residencyRegion=za` returns events with hash/signature verification results.
- `GET /api/admin/approval-ledger` gives admins a visual-ledger feed of user-account and image approval/sign-off events, combining signed audit records with clearly marked legacy workflow records.
- `POST /api/audit/exports` creates a signed JSON legal export for an admin/service identity; `GET /api/audit/exports/:id` downloads it from the matching residency bucket.
- `POST /api/verification/cases` starts a contributor verification case; documents are represented by hashes and provider references, not copied into the audit trail.

An audit event is accepted only after its signed R2 object is written and a conditional D1 chain-head insert succeeds. D1 triggers reject event updates/deletes. Operators should additionally enforce least-privilege R2/D1 roles, retention policy, key rotation, access reviews, and an independent backup/escrow process for evidentiary use.

## Production activation still required

The code is deployable as a staged foundation, but these external controls must be configured before accepting real users, media, or money:

- Connect a proven Workers-compatible authentication provider and replace the development `x-demo-user-id` seam with verified sessions and organisation membership checks.
- Configure R2 S3 credentials for presigned PUTs, private preview objects, CORS, media-processing workers/queues, and Cloudflare Images transformations.
- Configure Cloudflare Stream direct creator uploads, signed playback, and provider status mapping. Webhook verification is implemented; provider provisioning is not.
- Optionally provision the Workers AI binding, the `veld-archive-photo-index` Vectorize index, and both photo queues. Search remains deterministic without AI; when enabled, it embeds only the buyer's query and retrieves approved photo IDs from Vectorize, while image OCR/vision runs only from upload/approval jobs.
- OCR is separately opt-in. It stays unavailable with a `503` response until both `OCR_ENABLED=true` and an `AI` binding are configured. The model is pinned by `OCR_MODEL`; callers cannot select arbitrary models.
- Register a payment provider and payout rail, then connect checkout state transitions to verified webhooks and the double-entry ledger. Adapter contracts and tests are present; no fake payment is treated as paid.
- Configure Turnstile, audit signing keys, KYC provider secrets, WAF/rate limits, CSP, and production environment-specific bindings.

Never use the demo user header or seeded demo records as production identity or evidence.

## Provider abstraction layer

Integration code lives under `src/integrations`. Application services depend on the `PayoutProvider` and `DamProviderAdapter` interfaces and select implementations through registries, so changing vendors does not change payout or asset domain models.

Shared application rules are exposed through the stateless `archiveDomain` object in `src/shared.ts`. Browser and Worker code should use that facade for matching, confidence, formatting, and licence validation rather than importing each rule individually. External provider construction is owned by `IntegrationContainer` in `src/integrations/index.ts`; route handlers consume its provider registries and should not instantiate vendor adapters directly. Keep this boundary narrow—feature objects are preferred over a single global service object so modules remain cohesive and testable.

Payout adapters include Stripe Connect, configurable South African bank, mobile-money, and SEPA transfer implementations. The latter three accept an injected endpoint and credentials because bank and gateway payloads vary by institution.

DAM adapters include AEM Assets and Bynder. Both normalize source assets and metadata while keeping upload protocol details inside the adapter. Add a new vendor by implementing the relevant interface and registering it at the composition root; do not import vendor SDKs into domain code.

See [disaster recovery](docs/disaster-recovery.md), [observability](docs/observability.md), [budget alerts](docs/budget-alerts.md), and [launch checklist](docs/launch-checklist.md) for the production handoff.

Security and operational controls are documented in [security operations](docs/security-operations.md). Run `npm run test:migrations`, `npm run test:local-smoke`, and `npm run test:payments` against a configured Worker before promoting a release.
