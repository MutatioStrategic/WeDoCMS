# Stockvel

Stockvel is a Cloudflare-native foundation for a trusted South African photo and video licensing marketplace.

## Implemented phases

- Editorial landing page and natural-language search interface.
- Phase 1: contributor onboarding, role-gated asset creation and metadata editing, R2 upload sessions with completion checks, explainable search, governance queues, and editorial review actions.
- Phase 2: rights-aware licence validation and checkout records, Cloudflare Stream direct-upload/playback provisioning and webhook verification, explainability/provenance fields, community collections, takedown cases, mediation records, and provider-neutral integration adapters.
- Phase 3: privacy-conscious analytics, contributor/buyer reporting endpoints, append-only signed audit exports, residency-aware verification cases, DR replication, observability, and payout/DAM adapter contracts.
- D1 schema for contributors, organisations, assets, licences, ledger entries, analytics, rights cases, audit events, and upload sessions.
- Worker API for search, onboarding, asset ingestion, governance, campaign derivatives/bundles, checkout validation, analytics, rights cases, verification, Stream upload/playback/webhooks, upload completion, and server-side Turnstile verification.
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
- Photo enrichment pipeline: image upload → queued Workers AI visual metadata/OCR → seller/editor correction and approval. Live buyer search is deterministic and reads only approved title/description metadata; background vector/index jobs are not part of the query path.
- Idempotent `photo_ai_jobs` records, queue retries/dead-letter handling, scheduled recovery, vector deletion for rejected photos, and an admin re-index endpoint (`POST /api/admin/photo-index/rebuild`).

Visual cards render only the approved preview URL returned by the media service. When a derivative is unavailable, the UI shows an explicit unavailable state and does not fabricate or substitute a stock image. Development-only demo fallback is removed from production bundles and production API routes block seeded demo media.

## Local South African media fixtures

Run `npm run seed:demo-media` to download six real South African image/video files from Wikimedia Commons and Pixabay, apply migrations `0011_demo_media_seed.sql` and `0012_demo_media_video_source_fix.sql`, place the files in local R2, and verify the D1 records. The seed is local-only and does not write to a remote Cloudflare account. Source pages, direct download URLs, licences, and creator attribution are persisted on each seeded asset. Two people-containing images intentionally remain in `needs_review` and `editorial_only` so the governance flow can be tested.

## Local development

```powershell
npm install
npm run dev
```

Cloudflare binding types are generated in `worker-configuration.d.ts` and committed with the project so clean CI checkouts can typecheck without a network-dependent generation step. After changing `wrangler.jsonc`, refresh the production bindings with `npx wrangler types --env=production` and commit the updated file.

The frontend runs on Vite. To run the Worker API locally after installing Wrangler and configuring a D1 database, use:

```powershell
npm run worker:dev
```

`npm run worker:deploy` is production-only and refuses to deploy the root development bindings. It runs the production bundle gate, verifies the remote production secret names, checks the canonical Worker/Pages/mobile targets, performs a Wrangler dry-run, and preserves dashboard-managed values with `--keep-vars`. It requires a dedicated `env.production` block with `APP_ENV=production` and no demo, localhost, or placeholder values. Use `npm run worker:deploy:development` only for an intentional non-production Worker.

Agents changing bindings or deploying to Cloudflare must follow
[`docs/agent-deployment-safeguards.md`](docs/agent-deployment-safeguards.md).
The short version: validate D1 records and R2 objects together, dry-run the
selected Wrangler environment, and run the live media-and-screen smoke before
reporting a deployment as healthy.

Publish the production Pages shell with `npm run pages:deploy`. This builds the
production frontend, runs the release and Supabase auth wiring gates, and
publishes the `veld-archive` Pages project. Publish the Worker separately with
`npm run worker:deploy`; both commands fail before upload if the runtime auth
contract or production Supabase secret invariant is missing.

Set the production Pages project's `WORKER_API_ORIGIN` variable to
`https://veld-archive-api-production.blewisorlando.workers.dev`. The committed
Pages Function uses that value, with the same canonical origin as its fallback,
so the desktop client and native Expo client stay on the same production API.

Pushes to `main` and `better-2` run the full CI gate and then publish the
explicit `env.production` Worker. A push to `main` also publishes the desktop
Pages shell. The native Expo client uses the same Pages/API origin, so Worker
changes are available to both clients; native UI changes are typechecked in CI
and still require the normal signed Expo/App Store/Play release to reach an
installed app.

Configure the GitHub `production` environment with `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. Keep required reviewers enabled for that environment;
pull requests never receive these credentials. The post-deploy gate requires at
least five non-demo image previews; change `PRODUCTION_EXPECT_MIN_MEDIA` only
when the verified production catalogue is intentionally smaller.

### Buyer access demo environment

The demo build includes the complete buyer access choice: three introductory
free photo downloads, once-off download bundles, and monthly/annual unlimited
plan cards. Run `npm run build:demo` for the Pages asset and
`npm run worker:deploy:demo` for the `env.demo` Worker. Demo authentication is
explicitly enabled, the payment provider is set to `demo` (so no real charge
can be created), and migration `0032_introductory_free_downloads.sql` marks
the seeded artist photos as free-download candidates. Configure the demo
Worker's `SESSION_SECRET` and apply migrations to the demo D1 before sharing
the URL (`wrangler d1 migrations apply veld-archive --remote --env demo`).
For local UAT, start the Worker with test R2 signing credentials and run
`npm run test:e2e:access -- http://127.0.0.1:8787`; this exercises registration,
the three-download allowance, idempotent retries, subscription/bundle choices,
and seller photo-only opt-in (including the rejected video case).

### Auth0 and Supabase identity

Auth0 and Supabase can run together. Configure an Auth0 SPA application with Authorization Code + PKCE and a custom API that issues RS256 access tokens. Set `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, and the optional `VITE_AUTH0_ORGANIZATION` for the frontend. Set `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_ROLES_CLAIM` as Worker variables. The tenant Management API (`https://<tenant>/api/v2/`) is not the application API audience and must not be requested by the SPA. Register the deployed app URL as an allowed callback, logout, and web-origin URL in Auth0.

For Supabase, configure the Worker as the source of truth: set `SUPABASE_URL`, `SUPABASE_AUDIENCE`, `AUTH_PROVIDER=both`, and the required browser-safe `SUPABASE_ANON_KEY` secret (`wrangler secret put SUPABASE_ANON_KEY --env production`). Use either an explicit `SUPABASE_JWKS_URL` for asymmetric signing or the `SUPABASE_JWT_SECRET` Wrangler secret for this project's current legacy HS256 signing. The SPA loads `/api/auth/config` at runtime, so production and direct Worker deployments do not depend on Vite remembering to embed auth settings; `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` remain optional local fallbacks only. Supabase email/password signup, email confirmation, login, phone OTP signup/login, password recovery, and session refresh are handled by the Supabase client; the Worker verifies the Supabase JWT and exchanges it for the same application session. Phone sign-in is restricted to South African mobile numbers. Users enter a local number such as `073 712 3456`; the clients normalize it to `+27737123456` before calling Supabase, and the Worker rejects a Supabase phone claim outside the South African mobile range. Phone-only identities receive a stable internal contact address until a real contact email is collected by a later account workflow. The anon/publishable key is safe for browser use; never put a Supabase service-role key in the client or expose it from the Worker. For hosted Supabase, enable Auth > Providers > Phone and configure a supported SMS provider; the repository config enables SMS signup for local Supabase development but cannot provision hosted provider credentials. The web and native sign-in surfaces use Supabase's password recovery flow: reset requests return a privacy-preserving response, reset links return to the app, and the new password is submitted through the verified recovery session before the user signs in again. Configure the Supabase redirect allow list for the web origin and `stockvel://auth/recovery` for native builds. Demo deployments use explicit demo authentication and never receive the production Supabase secret.

The Worker verifies external tokens against the configured issuer/JWKS, retrieves the Auth0 `openid profile email` UserInfo profile when configured, and creates the existing HttpOnly session. Supabase identities are namespaced in `auth_subject` to prevent cross-provider collisions. For a single-organisation deployment, pre-provision `DEFAULT_ORGANIZATION_ID`; a browser-supplied organization ID is accepted only when it matches a signed claim or that configured default. Keep `AUTH_ALLOW_ORG_PROVISIONING=false` in production. The identity provider owns sign-in; D1 remains the source of truth for application roles, organization memberships, credits, licence ownership, ledger entries, and payment state. D1 `auth_security_events` records provider, outcome, subject hash context, and bounded request metadata; high-risk events are also emitted to Worker Logs and Analytics Engine.

Hosted Supabase authentication email delivery is implemented as a signed Send Email Hook in `supabase/functions/send-email`, with the function sending through Cloudflare Email Service REST API. Supabase remains responsible for generating and verifying confirmation and recovery tokens; no Supabase JWT or service-role key is sent to the function or browser. Set the function secrets and enable the hook only after the Cloudflare sender domain is onboarded. See [`docs/email-service.md`](docs/email-service.md#supabase-authentication-email-hook) for the deployment and secret checklist. The web and native clients provide a resend-confirmation action and surface rate-limit, unconfirmed-email, JWT, and organisation-provisioning failures separately.

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

The `npm run test:postman` sweep exercises the configured API and the main
desktop web shell. It is read-only by default: data-changing requests,
external providers, demo authentication, and the Supabase signup boundary are
opted out unless explicitly enabled. It
discovers every `/api` route from the Worker source and loads desktop
Vite values from the root `.env.local` (`VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`), with the mobile environment as a fallback.
Publishable keys are used only in memory and are never printed.

```powershell
$env:POSTMAN_DESKTOP_URL = "https://veld-archive.pages.dev"
$env:POSTMAN_BASE_URL = "https://veld-archive-api-production.blewisorlando.workers.dev"
npm run test:postman
```

The sweep rejects placeholder hosts such as `archive.example.com` before it
sends a request. Use `POSTMAN_RUN_WRITES=true` only against an isolated test
database. The identity-exchange and other external boundaries require
`POSTMAN_RUN_EXTERNAL_WRITES=true` plus the appropriate controlled test
token/configuration; the Supabase signup boundary is also disabled unless that
flag is enabled. The scheduled
`.github/workflows/production-postman-smoke.yml` workflow runs this safe
production check hourly and can also be started manually.
The scheduled `.github/workflows/demo-postman-roles.yml` workflow runs the same
safe route sweep for buyer, contributor (seller-facing), editor, and admin
sessions every six hours and can also be started manually.

#### Importable Postman collection

Import [`postman/veld-archive-route-sweep.postman_collection.json`](postman/veld-archive-route-sweep.postman_collection.json)
directly into the Postman app, then run the collection. It contains the desktop
shell and every `/api` route discovered at export time, defaults to the demo
Worker, and captures the demo-login session and CSRF tokens for later requests.
The exported file intentionally omits the external Supabase signup request and
contains blank credential-like variables.

The repository is also connected to Postman Local Mode through
`postman/.postman/resources.yaml`. Select the checked-in `demo (repo-safe)` environment in
Postman for the demo URLs and safe defaults. Select `production (read-only)` for
public production checks. The `00 - Start here` folder logs
in and verifies the selected role before the grouped endpoint folders run.
Read-only and session checks run immediately; data-changing requests are
skipped until `runWrites=true`, and external payment, webhook, integration, and
security-boundary requests remain skipped until `runExternalWrites=true`.

Set the collection variable `demoRole` to `buyer`, `contributor`, `editor`, or
`admin`, then rerun the collection to exercise that role's session in the
isolated demo environment. The contributor persona is the seller-facing demo
workflow in this build. Production uses `runDemoAuth=false` and
`runWrites=false`; authenticated production checks require real controlled
identities and must be enabled explicitly.

Regenerate it after adding or changing Worker routes:

```powershell
$env:POSTMAN_DESKTOP_URL = "https://veld-archive.pages.dev"
$env:POSTMAN_BASE_URL = "https://veld-archive-api-demo.blewisorlando.workers.dev"
npm run postman:export
```

The export command derives the route list from `src/worker/index.ts`; do not
hand-edit the generated JSON. Use `npm run test:postman` separately when the
Supabase signup boundary also needs to be exercised.

The blank `postman/postman/flows/New flow.flow` is kept as the app-created flow
canvas. The endpoint test plan belongs in the linked collection because it can
be run, filtered, and reported as a collection; the flow is not used as a
second, drifting copy of all route definitions.

Apply subsequent migrations in order as well; `0004_explainability_safety.sql` adds persisted metadata provenance and review status. Validate the chain with `npx wrangler d1 migrations list veld-archive --local`.

## Minimal media studio

Open **Media studio** from the desktop navigation. The screen is intentionally
split into two simple paths:

- **Quick photo edit** accepts one archive photo or one/more local image files.
  Crop, resize, apply a basic filter, add optional marketing text with placement,
  alignment, colour, style, and contrast-panel controls, then save or download PNG/JPEG.
- **Build a campaign** lets you name the campaign, add any number of selected
  photos, drag a small set of GrapesJS content blocks, edit the text, preview it
  in a sandboxed iframe, and export a ZIP.

The prominent top download button downloads the active edited image in quick
photo mode, or the full campaign ZIP in campaign mode. For an archive source
without an edit it calls the authenticated `/api/assets/:id/original` route; it
never exposes an R2 key in the browser. Local uploads remain temporary browser
object URLs.

GrapesJS, CropperJS, Pica, and JSZip are loaded with dynamic imports. This keeps
the one-photo path small and makes the editor seam replaceable: the campaign
component only relies on `init`, `getHtml`, `getCss`, and `destroy`. Campaign
export sanitizes HTML/CSS, bundles the selected or edited images, and writes
`index.html`, `styles.css`, `campaign.json`, and `images/` into the ZIP.

Run the focused export sanity checks with:

```powershell
npx vitest run src/studio-export.test.ts
```

With `npm run dev` running in another terminal, the browser smoke check covers
the local upload, CropperJS/Pica image download, GrapesJS initialization, and
campaign ZIP contents:

```powershell
npm run test:studio
```

The normal local commands remain `npm run dev`, `npm run typecheck`, `npm test`,
and `npm run build`.

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
- Configure Cloudflare Stream direct creator uploads, signed playback, allowed origins, customer code, and provider webhook delivery. The Worker adapter, short-lived playback-token route, idempotent webhook state mapping, and organization-scoped audit event are implemented; live provider configuration and verification remain a launch gate.
- Optionally provision the Workers AI binding, the `veld-archive-photo-index` Vectorize index, and both photo queues for upload-time enrichment and background indexing. Live search does not call Workers AI or Vectorize; it reads approved title/description metadata from D1.
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
