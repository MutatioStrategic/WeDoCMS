# Production security operations

The Worker now fails closed for identity and storage operations. Before a production deployment, configure the external controls below in the Cloudflare zone and the selected identity/payment providers.

## Required baseline Worker secrets

```text
SESSION_SECRET                 # >= 32 random characters; rotate by overlapping deployments
SUPABASE_ANON_KEY              # browser-safe publishable/anon key; store with Wrangler, never service-role
AUTH_JWKS_URL                  # Auth0/.well-known/jwks.json URL for RS256 verification
AUTH_ISSUER                    # expected issuer, including trailing slash
AUTH_AUDIENCE                  # expected API audience
AUTH_ROLES_CLAIM               # optional namespaced claim containing application roles
TURNSTILE_SECRET               # add when high-risk public actions are enabled
MEDIA_SCANNER_SECRET           # only when MEDIA_SCANNER_URL is configured
AUDIT_SIGNING_PRIVATE_JWK    # add before enabling audit exports/events
AUDIT_SIGNING_PUBLIC_JWK     # add before enabling audit exports/events
```

The production deployment gate currently requires only `SESSION_SECRET`,
`SUPABASE_ANON_KEY`, `DIDIT_API_KEY`, and `DIDIT_SIGNING_SECRET`. R2
presigning, remote vision, payments, Cloudflare Email Service, Turnstile,
media scanning, and audit signing remain optional capabilities until their
corresponding production controls are enabled.

`x-user-id`, `x-user-role`, and `x-demo-user-id` are not accepted as identity. Browser sessions use an HttpOnly, signed, revocable cookie plus a CSRF token. External IdP tokens are accepted only through the verified JWT exchange endpoint.

The production SPA obtains Supabase settings from the Worker-owned
`GET /api/auth/config` route. Confirm `AUTH_PROVIDER=supabase` or `both`,
`SUPABASE_URL`, and `SUPABASE_AUDIENCE` in the selected Wrangler environment,
then run `npm run auth:check` before every deployment. The route returns the
publishable key only after validating its anon/publishable shape and never
returns JWT audience, signing, or service-role secrets.

### Supabase identity to Veld tenancy

Supabase authenticates the person; it does not create a Veld organisation or
membership. The Worker verifies the Supabase subject, exchanges it for an
HttpOnly Veld session, and resolves `DEFAULT_ORGANIZATION_ID` (or a signed
organisation claim) against D1. The resulting session organisation ID is the
tenant boundary used by R2, AI, Vectorize, queues, and application queries.
Keep the production organisation pre-provisioned with
`AUTH_ALLOW_ORG_PROVISIONING=false`; a first successful exchange creates the
active D1 user and membership in that organisation.

Some hosted Supabase projects still sign access tokens with legacy HS256 and
return an empty string for optional profile fields such as `phone`. When a
`SUPABASE_JWT_SECRET` is unavailable, the Worker verifies the bearer token via
Supabase's authenticated `/auth/v1/user` endpoint and normalizes empty optional
claims before applying the schema. The regression is covered in
`src/worker/auth.test.ts`; an exchange error about organisation provisioning
must not be used to mask a failed token verification.

## CORS and browser policy

Set `ALLOWED_ORIGINS` to exact HTTPS origins only. Do not use `*` with authenticated requests. The Worker emits CSP, HSTS, frame, MIME, referrer, permissions, and cross-origin isolation headers.

## Auth0 bootstrap values

The deployed production Worker is `https://veld-archive-api-production.blewisorlando.workers.dev` and the SPA origin is `https://veld-archive.pages.dev`. Create an Auth0 SPA application and API with these values before adding the Worker secrets:

- Allowed callback URL: `https://veld-archive.pages.dev`
- Allowed logout URL: `https://veld-archive.pages.dev`
- Allowed web origin: `https://veld-archive.pages.dev`
- API audience: `https://veld-archive-api-production.blewisorlando.workers.dev`
- Worker values: `AUTH_JWKS_URL=https://<tenant>/.well-known/jwks.json`, `AUTH_ISSUER=https://<tenant>/`, and `AUTH_AUDIENCE` equal to the API audience.

The Auth0 tenant/application cannot be created from the current Cloudflare session; it requires an authenticated Auth0 Management API session or dashboard administrator access.

## Cloudflare WAF/API controls

Create zone rules for the production hostname:

1. Managed WAF ruleset: enabled, with an exception only for verified provider webhook signatures.
2. Rate limit `POST /api/auth/*`, `/api/rights/*`, `/api/uploads*`, `/api/checkout*`, and `/api/webhooks/*` separately; use the Worker D1 limiter as a second layer.
3. Block non-HTTPS traffic and requests with bodies above the application limits.
4. Turnstile or Bot Management on sign-in, seller onboarding, rights cases, and upload-session creation.
5. API Shield/schema validation for webhook routes and mTLS or a private service path for payment/KYC service calls where supported.
6. Alert on 401/403/409/422/429/5xx spikes, payment webhook failures, media scan errors, queue retries, and reconciliation discrepancies.

## Upload safety

Uploads require a private R2 presigned PUT, an exact declared size, a recognised media signature, and a passed scan. In production, `MEDIA_SCANNER_URL` is required; signature-only scanning is development-only. Assets remain unavailable to the publication workflow until scanning succeeds.

## Money operations

Payment providers must sign `/api/webhooks/payments`. The endpoint deduplicates provider event IDs, enforces settlement idempotency, posts balanced ledger entries, prevents over-refunds, and records refund/chargeback reversals. Run `/api/ops/reconciliation/payments` after provider settlement windows and before payout batches.

## Operational drills

- Apply migrations to a staging D1 database and run `npm run test:migrations`.
- Run `npm run test:local-smoke` against a local Worker with a non-production secret.
- Restore a recent D1 export into an isolated database, run `PRAGMA integrity_check`, verify row counts, and exercise the replacement Worker before promoting bindings.
- Verify R2 replication manifests, queue dead-letter replay, audit signature verification, and payment reconciliation during every release candidate.

## Production readiness gate

An authenticated administrator can call `GET /api/ops/readiness`. The response is deliberately fail-closed and reports only booleans and remediation text, never secret values. It requires live production identity, media/scanning, Stream, payment, KYC, audit-key, AI/Vectorize/queue, D1, primary R2, DR R2, and backup R2 configuration. It also blocks when demo rows remain or migration `0015_personalized_discovery.sql` is absent.

Set `EDGE_CONTROLS_ATTESTED_AT`, `KEY_ROTATION_ATTESTED_AT`, and `BACKUP_RESTORE_ATTESTED_AT` only after the corresponding live drill passes, using an ISO-8601 date/time. These attestations do not replace evidence in Cloudflare/provider logs; they prevent an unverified external control from being silently treated as complete by the application release gate.
