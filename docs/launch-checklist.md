# Production launch checklist

## Identity and tenancy

- [ ] Configure the selected authentication provider and callback URLs.
- [x] Replace `x-demo-user-id` with verified session claims in application code.
- [x] Enforce organisation membership and role permissions on every private route in the Worker.
- [ ] Test account deletion, export, email verification, password reset, and MFA readiness.

## Media and search

- [ ] Create private R2, DR, audit, and jurisdiction-specific KYC buckets.
- [ ] Configure R2 CORS and short-lived presigned PUT credentials.
- [ ] Configure media-processing queues, image transformations, and Stream direct uploads.
- [ ] Configure signed Stream playback and webhook delivery.
- [ ] Provision Workers AI and Vectorize; enable semantic search only after index tests pass.
- [ ] Replace all demo visual cards with approved, licensed media.

## Rights and money

- [ ] Configure Turnstile site keys and server secret for all high-risk actions.
- [x] Implement payment webhook deduplication, idempotency, refund, chargeback, and reconciliation paths.
- [ ] Select and verify the payout rail; test ledger-to-payout reconciliation.
- [ ] Upload and review model/property releases using the configured KYC/document provider.

## Security and operations

- [ ] Set production WAF rules, edge rate limits, secure-cookie domain policy, origin allowlists, and secret rotation.
- [x] Add Worker-side CORS allowlisting, CSP/security headers, CSRF validation, D1 rate limits, upload quotas, and production fail-closed scanning.
- [ ] Store Ed25519 audit JWKs and test signed export verification offline.
- [ ] Run migrations against staging, then production, with a D1 export backup.
- [ ] Verify DR replication, restore procedure, queue dead-letter handling, and observability alerts.
- [x] Run typecheck, unit/integration tests, build, accessibility review, authenticated smoke, penetration smoke, DR restore smoke, migration, and payment reconciliation tests locally.
