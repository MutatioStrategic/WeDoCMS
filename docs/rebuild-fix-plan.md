# WeDoCMS rebuild and repair plan

This plan turns the lessons from the current repository into a small set of
vertical slices. Each slice names the actor, the decision they are making, the
authoritative boundary, and the observable proof that the flow is safe.

## Product contract

WeDoCMS is a tenant-scoped archive and licensing system. A user must always be
able to answer: *what can I do next, what evidence supports this state, who can
see it, and what happens if the request is retried?* The public catalogue only
shows intentionally published work. Seller, buyer, editor, and admin surfaces
share domain rules but never share client-controlled identity or tenant state.

## Stack decision for a clean rebuild

Keep the Cloudflare Worker as the edge/BFF layer for session validation, tenant
middleware, public catalogue reads, upload presigns, signed media delivery, and
queue dispatch. It is close to the user and already matches the R2/D1 contract.

Put payment sessions, double-entry ledger transactions, payout batches, webhook
reconciliation, and subscription state behind a dedicated transaction service
when those workflows outgrow the Worker. Spring Boot + Java is a good fit for
that bounded context because typed transaction objects, database transactions,
outbox processing, and provider retries are easier to make explicit and test at
scale. The Worker would call it through an idempotent, signed internal API; the
service would own the ledger database and publish normalized events. The React
web app and mobile client would continue to call the Worker, so middleware
remains the single place for session, tenant, CSRF, rate-limit, and response
shape enforcement. This is a seam to earn with measured payment volume, not a
reason to split the whole archive prematurely.

## User stories and acceptance criteria

### 1. Identity and tenant onboarding

As a verified person, I can enter the default archive or an organisation to
which I was explicitly invited.

- A new identity may use the default organisation, a provider claim that is
  explicitly provisioned, or a valid, unexpired invitation matching the
  verified email.
- A client-supplied organisation ID alone never creates membership.
- User, organisation, membership, and invitation acceptance commit together;
  retrying the exchange cannot create duplicate records.
- The session is issued from verified claims and server-side membership, not
  `x-user-*`, local storage, or a browser tenant ID.

### 2. Public discovery

As an anonymous visitor, I can search a calm, evidence-led catalogue.

- Search is Enter/button addressable and exposes kind, orientation, location,
  category, verification, and sort controls.
- The public route clamps workflow status to `published`; review queues remain
  authenticated and tenant-scoped.
- Every card exposes provenance, rights context, and a clear next action.
- Loading, empty, unavailable, and retry states are explicit and do not leak
  private evidence or storage keys.

### 3. Seller upload and recovery

As a contributor, I can upload once, see progress, retry safely, and know when
my asset needs review.

- The server validates size, signature, and malware/media scan before any
  derivative is generated.
- Completion is idempotent by upload ID; concurrent retries return the same
  asset instead of creating random duplicates.
- A failed persistence transaction cleans up generated derivatives and leaves
  the source private and recoverable.
- The UI preserves entered metadata and gives a retry/needs-review action.

### 4. Editorial publication

As an editor, I can publish only an asset whose rights, releases, and current
metadata revision are ready.

- The same `archiveDomain.publicationGate` runs in every approval route.
- Blockers are returned as structured codes so the UI can explain the next
  action (rights verification, model release, property release, or metadata
  review).
- Published search results require the approved revision and never expose
  draft evidence.

### 5. Buyer licensing and delivery

As a buyer, I can request, pay for, and download a licence without crossing a
tenant boundary.

- Seller rights/subaccount readiness, agreement count, amount, currency, and
  licence status are rechecked server-side at checkout.
- Success and cancel URLs are constrained to the current deployment origin.
- Provider sessions and webhook events carry idempotency keys; duplicate
  callbacks cannot double-settle credits or ledger entries.
- Downloads use authenticated response semantics and never assume a redirect
  when a provider returns a binary response.

### 6. Webhooks and integrations

As an admin, I can register a webhook and inspect delivery state without
turning the archive into an SSRF proxy.

- Production targets use HTTPS and reject localhost, link-local, and private
  address patterns; unsafe legacy subscriptions are disabled before delivery.
- Vendor payloads are normalized by adapters in `IntegrationContainer`; route
  handlers depend on narrow domain interfaces.
- Delivery records include correlation IDs, status, attempts, and retry-safe
  idempotency keys, but never secrets or raw evidence.

### 7. Mobile parity

As a mobile user, I can complete the same upload, review, and download journey
with the same server authority.

- Mobile uses the same API contracts and error codes as web.
- Web sessions use HttpOnly cookies; native sessions use platform-secure
  storage and short-lived access tokens with refresh rotation.
- Narrow layouts have one scroll region, visible focus, labelled controls, and
  a recoverable offline/unavailable state.

## Build order

1. Lock identity, invitation, tenant, and public-catalogue boundaries.
2. Make upload completion and publication gates transactional and idempotent.
3. Harden payment return URLs, webhook delivery, and provider adapters.
4. Remove duplicate/legacy seams only after migration and contract tests prove
   the canonical tables are complete.
5. Split large frontend/Worker modules along the journeys above and add mobile
   parity after the server contracts are stable.

## Definition of done for each slice

The happy path, empty/loading/error/unavailable states, keyboard/mobile path,
tenant isolation, idempotent retry, OpenAPI contract, and a public-interface
regression test are all demonstrated. Deployment checks also prove the D1
catalogue and R2 media keys resolve in the selected Wrangler environment.
