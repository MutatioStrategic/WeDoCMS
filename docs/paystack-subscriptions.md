# Paystack buyer subscriptions

WeDoCMS uses Paystack as the payment authority for buyer subscriptions.

## Runtime flow

1. A signed-in buyer starts `POST /api/subscription/session`.
2. The Worker initializes a Paystack transaction with the configured `plan` and stores a pending local record.
3. Paystack redirects the buyer to its hosted checkout and sends signed webhooks to `POST /api/webhooks/payments`.
4. Only a verified Paystack webhook changes subscription access or records a successful transaction. The browser callback is informational.
5. Paystack event IDs, transaction references, invoice codes, amounts, periods, and raw signed payloads are retained for buyer history and reconciliation.

## Configuration

Set the non-secret plan values so they exactly match the Paystack plan:

- `PAYSTACK_SUBSCRIPTION_PLAN_CODE`
- `BUYER_SUBSCRIPTION_AMOUNT_CENTS`
- `BUYER_SUBSCRIPTION_INTERVAL`

Keep `PAYMENT_TOKEN` and `PAYMENT_WEBHOOK_SECRET` in Worker secrets. Configure the Paystack webhook URL as:

`https://<public-app-host>/api/webhooks/payments`

The webhook must be publicly reachable over HTTPS and the secret must match the Paystack integration key used to initialize transactions.

## Payment methods

Paystack-hosted one-time checkout can show the payment channels enabled in the Paystack Dashboard for the South African account, including Card, QR, EFT, Apple Pay, and Capitec Pay where Paystack has enabled them for the merchant.

Apple Pay additionally requires Paystack dashboard activation and registration/verification of each application domain. For a custom web app, host Paystack’s downloaded verification file at `/.well-known/<file>` with content type `application/text` over HTTPS.

Paystack’s recurring Subscriptions API currently supports Card and Nigerian Direct Debit only. Therefore Apple Pay, QR, EFT, and Capitec Pay must not be promised as recurring subscription methods. They can remain available for one-time purchases; Paystack decides the actual channels shown at checkout.

Before production, confirm the South African account’s eligibility, subscription plan currency, Apple Pay activation, and any Capitec Pay/EFT KYC requirements in writing with Paystack.
