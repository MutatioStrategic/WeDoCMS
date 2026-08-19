# Zoho ecosystem integrations

The CMS now exposes a rights-aware Zoho integration boundary. It is designed
around the existing campaign workflow: brief → ranked sources → human approval
→ licensed pack → external handoff.

## Included now

| Zoho app | CMS capability | Delivery boundary |
| --- | --- | --- |
| Zoho Social | Send an approved campaign to a reviewable Social draft/schedule handoff with copy, channels, public preview URLs, attribution, and a CMS idempotency key. | Zoho Flow webhook → Social custom action/connector |
| Zoho CRM | Upsert a campaign record with approved-asset count, platforms, usage rights, brief, and CMS URL. | Zoho CRM v8 `/crm/v8/{module}/upsert` |
| Zoho Desk | Send rights/takedown cases to a Desk ticket workflow with reason, summary, response deadline, asset, and CMS case URL. | Zoho Flow webhook → Desk ticket |
| Zoho Campaigns | Optional campaign/email handoff payload is supported through Flow; keep final recipient/list/send approval in Zoho. | Zoho Flow webhook |
| Zoho Analytics | Optional event handoff endpoint is available in the integration adapter for reporting pipelines. | Zoho Flow webhook |

The browser never receives a client secret or refresh token. Tenant OAuth
refresh tokens are encrypted with the Worker secret `ZOHO_TOKEN_ENCRYPTION_KEY`
before being stored as ciphertext in `zoho_connections`; D1 also stores the
OAuth state, contract metadata snapshot, provider references, redacted
metadata, and delivery status. The legacy environment refresh-token path remains
available for a single deployment-wide connection.

Every outbound Flow payload carries `contractVersion: "1.0"`. Social and Desk
payloads are validated before leaving the Worker. CRM custom fields are omitted
unless their target Zoho API names are explicitly configured; this prevents a
field label from being mistaken for an API name.

## Routes

- `GET /api/integrations/zoho/status`
- `POST /api/integrations/zoho/connect/start`
- `GET /api/integrations/zoho/oauth/callback`
- `POST /api/integrations/zoho/crm/validate`
- `GET /api/integrations/zoho/outbox`
- `POST /api/integrations/zoho/outbox/:id/retry`
- `POST /api/campaigns/:id/integrations/zoho/social`
- `POST /api/campaigns/:id/integrations/zoho/crm`
- `POST /api/rights/cases/:id/integrations/zoho/desk`

The Social route fails closed unless the campaign has an approved source, a
current paid licence, valid release/rights state, and published media. It sends
a reviewable handoff; it does not claim that a Social post was published.

## Zoho setup

1. Create a Zoho OAuth client in the same data centre as the Zoho account and
   register `${APP_PUBLIC_URL}/api/integrations/zoho/oauth/callback` as the
   redirect URI.
2. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and a randomly generated
   `ZOHO_TOKEN_ENCRYPTION_KEY` as Worker secrets. Grant only the CRM scopes
   needed for the selected module and upsert action.
3. Create a CRM external text field such as `Veld_Archive_ID` and mark it as
   an external/unique field. Set that API name as `ZOHO_CRM_EXTERNAL_FIELD`.
   Configure the optional correlated fields in `.env.example` only when those
   fields exist in the selected CRM module.
4. Create Zoho Flow workflows for the Social and Desk webhook payloads. The
   Social workflow should create a draft or scheduled item for a human review
   step, not bypass the Zoho Social publishing permissions.
5. Store values with Wrangler, for example:

```powershell
wrangler secret put ZOHO_CLIENT_SECRET
wrangler secret put ZOHO_TOKEN_ENCRYPTION_KEY
wrangler secret put ZOHO_SOCIAL_FLOW_WEBHOOK_URL
wrangler secret put ZOHO_DESK_FLOW_WEBHOOK_URL
```

The module/API field names are deliberately configurable because Zoho CRM uses
the field API names from the target CRM account, not display labels.

Requests create a durable `zoho_outbox_jobs` record and return `202` with a
job ID. A queue consumer or scheduled reconciliation dispatches the job. The
idempotency key is unique in D1, and the provider request repeats that key for
Flow deliveries. Retryable HTTP failures are delayed with backoff; a network
failure with an unknown provider outcome is marked `unknown` and requires an
explicit admin retry so a Social draft or Desk ticket is not silently duplicated.

## Operational rule

The CMS remains the source of truth for asset rights and campaign approval.
Zoho Social is the publishing and engagement system of record after a human
review; Zoho CRM is the relationship/reporting record; Zoho Desk is the service
queue for rights cases. A webhook response is recorded as a handoff only and is
never treated as proof that a social post was published or that a ticket was
resolved.
