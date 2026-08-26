# P1 production operations

## Marketplace and creator pages

- Apply `0014_p1_marketplace_growth.sql` in staging, verify `/api/creators` and a public `/api/creators/:slug`, then apply it in production.
- Only profiles with `visibility = public` are discoverable. Confirm every public profile has approved copy, an intentional slug, and an approved featured asset.
- Serve `/creators/:slug` through the SPA fallback, and configure the production renderer/prerender job to read the public creator API and emit canonical title, description, and Open Graph tags for each public creator URL.

## Media delivery

- Set `STREAM_ACCOUNT_ID`, `STREAM_ALLOWED_ORIGINS`, and `STREAM_CUSTOMER_CODE`; configure the `STREAM_API_TOKEN` and webhook signing secret through the bound Secret Store entries (`STREAM_API_TOKEN_STORE` and `STREAM_WEBHOOK_SECRET_STORE`). Local development may use the equivalent Worker secret variables. Enable direct uploads, signed playback, and the signed webhook at `/api/webhooks/stream`.
- A video remains `processing` until the signed Stream webhook marks it ready; it then enters editorial review. Treat Stream errors as failed processing, not as a publishable asset.
- The `IMAGES` Worker binding provides cached `thumb`, `card`, and `preview` variants directly from private R2 bytes. Card/thumb use cover crops; preview preserves framing; AVIF/WebP/JPEG is negotiated from `Accept`. Do not expose an anonymous `download` variant.
- Keep originals private in R2. Buyer downloads use the paid licence endpoint and are recorded in both `asset_events` and immutable licence evidence.

## Identity and account lifecycle

- Set `AUTH_ACCOUNT_PORTAL_URL` to the identity provider’s verified account-management surface. It must support email verification, password resets, and MFA enrolment; never manage password or MFA secrets in D1.
- Test account export delivery, the 30-day deletion recovery window, organization invitations, and notification preferences using a non-production identity.

## Licensing and analytics

- Review `licence_products` terms and restrictions with counsel before activating a product. Each changed term version must create a new product version or immutable evidence snapshot.
- Publish the reviewed `seller-marketplace-v1`, `buyer-marketplace-v1`, and `payment-split-v1` documents. Onboarding and checkout record the accepted version and SHA-256 snapshot in `marketplace_agreement_acceptances`.
- Reconcile licence receipts, evidence hashes, downloads, and settlement events weekly. Contributor performance is event-led; anonymous discovery remains aggregated and does not retain IPs, user agents, cookies, or visitor identifiers.

## Paystack test checkout

- Configure `PAYMENT_PROVIDER=paystack` and `PAYMENT_ENDPOINT=https://api.paystack.co/transaction/initialize`; store the test secret as both `PAYMENT_TOKEN` and `PAYMENT_WEBHOOK_SECRET` Worker secrets. The public key is not required for server-initialized hosted checkout.
- In the Paystack test dashboard, set the webhook URL to `https://veld-archive-api-production.blewisorlando.workers.dev/api/webhooks/payments`. The Worker verifies `x-paystack-signature` with HMAC-SHA512 before accepting `charge.success` or `refund.processed` events.
- Complete a test payment and a processed test refund, then reconcile the resulting licence, immutable receipt evidence, and balanced ledger entries before replacing the test key with a separately provisioned live key.
- For each staged seller, verify the Paystack subaccount through provider evidence, test a Paystack percentage split (for example 60% artist / 40% WeDoCMS), and confirm the provider fee bearer, refund/chargeback behavior, tax treatment, reserves and marketplace/PASA obligations in writing.
