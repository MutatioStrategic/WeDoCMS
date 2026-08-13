# Production launch readiness

The Worker deliberately remains in development mode until the account owner
completes the following external, irreversible steps. The admin endpoint
`GET /api/admin/launch-readiness` makes these conditions visible in-app; it
does not disclose secret values.

## Email

Cloudflare Email Sending currently has no enrolled domain in this account.
Enroll a domain, complete its DNS verification, then set the verified sender:

```text
npx wrangler email sending list
npx wrangler secret put EMAIL_FROM
npx wrangler secret put EMAIL_FROM_NAME
```

The `EMAIL` binding is already configured in `wrangler.jsonc`. Do not deploy a
production sender until the service account can list the verified domain and a
test delivery has arrived in a controlled mailbox.

## Payout rail

Choose and contract one rail, then set only the corresponding production
secrets. Stripe uses `STRIPE_SECRET_KEY`; PayFast uses `PAYFAST_ENDPOINT` and
`PAYFAST_TOKEN`; the South African bank adapter uses `ZA_BANK_ENDPOINT` and
`ZA_BANK_TOKEN`. Verify with a provider sandbox and a real, low-value
controlled payout before the first contributor batch is approved.

## Final production switch

After the external checks pass, set `APP_ENV=production`, set
`DEMO_AUTH_ENABLED=false`, replace development origins/hostnames with the
production hostnames, apply migrations, deploy, and check `/api/health` plus
the authenticated launch-readiness endpoint. The account owner must perform
this switch because it requires domain control and provider credentials.
