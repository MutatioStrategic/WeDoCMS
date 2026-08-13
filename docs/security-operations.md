# Production security operations

The Worker now fails closed for identity and storage operations. Before a production deployment, configure the external controls below in the Cloudflare zone and the selected identity/payment providers.

## Required Worker secrets

```text
SESSION_SECRET                 # >= 32 random characters; rotate by overlapping deployments
AUTH_JWT_SECRET                # HS256 verification secret for the configured identity provider
PAYMENT_WEBHOOK_SECRET         # provider webhook signing secret
TURNSTILE_SECRET               # required for high-risk public actions
MEDIA_SCANNER_SECRET           # only when MEDIA_SCANNER_URL is configured
AUDIT_SIGNING_PRIVATE_JWK
AUDIT_SIGNING_PUBLIC_JWK
```

`x-user-id`, `x-user-role`, and `x-demo-user-id` are not accepted as identity. Browser sessions use an HttpOnly, signed, revocable cookie plus a CSRF token. External IdP tokens are accepted only through the verified JWT exchange endpoint.

## CORS and browser policy

Set `ALLOWED_ORIGINS` to exact HTTPS origins only. Do not use `*` with authenticated requests. The Worker emits CSP, HSTS, frame, MIME, referrer, permissions, and cross-origin isolation headers.

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
