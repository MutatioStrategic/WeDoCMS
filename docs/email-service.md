# Transactional email

The Worker records every notification in D1 and sends a best-effort transactional email when the native Cloudflare Email Service binding is configured. Email failure does not fail the originating upload, review, rights, or payout request; the in-app notification remains the source of truth.

## Production setup

1. Onboard the sending domain in Cloudflare Email Service and wait for SPF, DKIM, and DMARC verification.
2. Keep the `send_email` binding named `EMAIL` in `wrangler.jsonc`.
3. Store the sender address as a secret; it must belong to the onboarded domain:

   ```text
   npx wrangler secret put EMAIL_FROM
   npx wrangler secret put EMAIL_FROM_NAME
   ```

4. Deploy and verify an asset-review, rights-case, and payout notification with a controlled recipient.

The Worker prefers `EMAIL` + `EMAIL_FROM`. The existing `EMAIL_PROVIDER`, `EMAIL_ENDPOINT`, `EMAIL_TOKEN`, and `EMAIL_FROM` variables remain available for a provider-neutral HTTP JSON fallback when a deployment cannot use the Cloudflare binding.

Do not put sender credentials, recipient lists, private evidence, or notification tokens in client code or logs. Keep the binding restricted with `allowed_sender_addresses` once the production sender address is chosen.
