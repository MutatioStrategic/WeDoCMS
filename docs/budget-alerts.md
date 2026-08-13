# Cloudflare usage and budget alerts

Cloudflare’s native budget alerts are account-level and informational: they notify by email when usage-based spend crosses a configured dollar threshold. They do not cap or pause usage, and billing data is processed daily rather than in real time.

Configure these in the Cloudflare dashboard:

1. Open **Manage Account → Billing → Billable Usage → Create budget alert**.
2. Create a warning and an escalation threshold appropriate to the approved monthly budget.
3. Add on-call and finance recipients.
4. Under **Notifications**, add product-specific usage notifications for Workers, R2, and Stream where available.
5. Review the billable-usage dashboard weekly and keep thresholds aligned with the current billing cycle.

This repository cannot create account billing alerts through Wrangler, and no billing API credentials are stored in source control. The Worker’s Analytics Engine metrics provide the operational signal for request, upload, R2, and Stream spikes; the Cloudflare dashboard remains the source of truth for spend.
