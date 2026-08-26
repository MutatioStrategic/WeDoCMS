# Veld Archive app-flow repair prompt

## What the audit found

The product already has most of the required API and persistence seams, but the
interfaces expose them as separate destinations instead of one resumable task.
That makes the implementation feel like a site map while the product deck
describes an application.

The most important breaks are:

- A buyer can search and inspect an asset, but the asset action sends them away
  to governance instead of keeping the selected asset through sign-up, licence
  validation, terms acceptance, payment, and delivery status.
- Buyer subscription controls live in Account, buyer reporting lives in Buyer
  ROI, campaign work lives in Campaigns, and per-asset checkout lives in an
  editor/admin governance screen. The next action is not owned by one buyer
  workspace.
- A seller sees onboarding, legal documents, verification, a second seller
  setup form, upload, library, and analytics stacked as independent pages or
  panels. Web has no persistent upload action. Expo has a central `Create` tab,
  but the label does not say that it uploads media and it initially opens
  onboarding rather than the next incomplete seller step.
- Anonymous gated navigation reports that sign-in is required without opening
  sign-in or preserving the destination. Web sign-up does not ask whether the
  new account is buying or selling, even though the Worker safely supports a
  seller intent for newly provisioned accounts.
- Navigation exposes implementation areas instead of a role-specific task
  hierarchy. Editor governance, integrations, buyer ROI, and contributor tools
  compete equally with the user’s next action.
- Loading and failure states are generally present, and the server-side rights,
  agreement, payment, session, CSRF, tenancy, idempotency, and webhook gates are
  useful foundations. The repair should orchestrate those seams rather than
  inventing client-side truth.

The Figma deck’s intended journeys are the acceptance baseline:

- Contributor: profile and tender -> upload session -> AI suggestions -> human
  correction -> approval and index.
- Buyer: search -> inspect evidence and rights -> validate -> request -> pay ->
  deliver, with no original released until the signed payment webhook is
  verified.
- Campaign: save approved media -> shape formats -> recheck licence -> package
  an auditable bundle.

## Reusable implementation prompt

```text
You are repairing Veld Archive as a task-oriented application, not redesigning
it as a collection of marketing pages.

First inspect the repository, docs/ux-process-flows.md, security and launch
documentation, the Figma High-Level Product Flows deck, relevant API routes,
all callers, and existing smoke tests. Treat `main` as the Cloudflare web
application under test and `better-2` as the Expo iOS/Android application.
Do not transplant web navigation into native mobile or assume the branches use
the same shell. Keep shared journey semantics and server contracts consistent,
then express them with platform-native navigation.

Product outcome

Make the next successful action obvious and preserve the user’s intent across
authentication and recoverable errors.

Buyer journey

1. A public user can search and inspect provenance, rights, releases,
   verification, price/access model, and licence scope on an asset.
2. The primary action is Buy/licence media (or the truthful free-download or
   custom-quote variant), not a link to governance.
3. If signed out, open account creation/sign-in in context and retain the asset
   and intended action. Buyer is the default account intent.
4. In the same flow, call POST /api/checkout/validate and show every server
   check, blocking reason, licence type, territory, duration, and price before
   terms or money.
5. Show the current Buyer Licence and Payment Terms separately from editable
   controls. Require an explicit checkbox. Submit the versioned agreement data
   only to POST /api/checkout.
6. If a pending licence is created but Paystack session creation fails, say so
   and offer Continue to payment. Do not create duplicates and do not claim
   that redirect success proves payment.
7. After signed webhook confirmation, expose controlled delivery and the
   licence snapshot. Pending, failed, cancelled, and paid states each need a
   useful next action.
8. Put subscription/free allowance, pending licences, campaign work, and buyer
   insights in one buyer home with progressive disclosure.

Seller journey

1. Provide a persistent, labelled `+ Upload media` action for authenticated
   contributors. On Expo use a central native Upload tab/action with a plus
   affordance; on web use the application shell.
2. If signed out, `Sell your media` opens seller account creation and sends the
   existing `accountIntent: "seller"` only through the verified identity
   exchange used for newly provisioned accounts.
3. Replace the long stack of duplicate panels with one seller home and clear
   steps: profile, identity/terms/payout, upload, review status, library.
4. Resume at the first incomplete prerequisite, but keep Upload visible and
   explain exactly what blocks submission or publication.
5. Upload uses the real private upload-session flow with accepted types, size,
   progress, retry, completion, and review status. Never expose raw R2 keys or
   claim an upload is searchable before editorial approval.

Navigation and shell

- Show role-relevant destinations and one role-aware primary action. Hiding a
  control is usability only; every API remains server-authorized.
- Public: Explore, Search, Creators, Community/Rights, Sign in, Sell media.
- Buyer: Find media, Buyer home, Campaigns, Account.
- Contributor: Seller home, Upload, Library/insights, Account.
- Editor/admin: Review queue, Governance, operational integrations, Account.
- A gated action opens authentication instead of emitting a dead-end notice.
  Preserve and resume the pending destination/action after success.
- Use URL/history state on web and native state/navigation on Expo. Back,
  Escape, modal close, focus return, deep links, and device back must behave
  predictably.

Architecture and safety

- The Worker is authoritative for session identity, organisation, role,
  rights, price, agreement versions, licence state, payment state, and original
  delivery. Never trust local storage, headers, or client role/tenant claims.
- Keep shared licence and matching rules behind archiveDomain and providers
  behind IntegrationContainer. Do not duplicate validation in UI; client-side
  summaries are previews of the server response.
- Preserve CSRF, HttpOnly cookie/bearer-session rules, tenant scoping,
  idempotency, signed Paystack webhook activation, private originals, audit
  records, and fail-closed provider behavior.
- Do not invent routes, fake successful states, or silently fall back to sample
  financial/rights data.

Platform requirements

- Cloudflare web (`main`): role-aware sidebar, visible primary action, keyboard
  and focus behavior, responsive single-scroll layout, contextual auth, inline
  asset checkout, and a coherent buyer/seller home.
- Expo iOS/Android (`better-2`): follow the repository’s exact Expo-version
  guidance, use native Pressable/Modal/Linking/ImagePicker patterns, respect
  device back and safe areas, keep touch targets comfortable, and never depend
  on DOM-only behavior. The current package/SDK version must be reported if it
  differs from the required documentation; do not hide the mismatch.

Tracer acceptance scenarios

A. Anonymous buyer: Explore -> asset -> Buy -> create buyer account -> return
   to same asset -> validate -> read/accept terms -> create pending licence ->
   Paystack -> webhook-paid -> controlled original.
B. Returning buyer with a pending licence: Buyer home -> Continue payment ->
   webhook result -> download or actionable failure.
C. New seller: Sell media -> seller sign-up -> profile -> verification/terms/
   payout -> + Upload media -> private upload -> needs review -> correction ->
   approved/searchable.
D. Returning seller: open app -> tap + Upload media directly -> upload failure
   retains metadata -> retry safely -> see review status in library.
E. Editor: Review queue -> evidence and AI suggestions -> correct -> approve ->
   confirm public search visibility; no buyer checkout controls appear here.

For each tracer, cover loading, empty, error, retry, backend-unavailable, narrow
screen, keyboard/device-back, and duplicate-submission behavior. Add observable
tests through public interfaces, update docs/ux-process-flows.md, then run the
smallest relevant checks during each slice and the proportional final gates:
typecheck, unit/integration tests, build, accessibility, auth, payments,
migrations, mobile typecheck, and mobile QA. Report any gate that cannot run and
why; never represent an unrun or environment-blocked check as passing.
```

## Explicitly out of scope

- Replacing Auth0, Supabase, Paystack, Didit, Firma, D1, or R2.
- Letting the browser or mobile client decide role, rights, price, paid state, or
  release access.
- Making Expo mimic the desktop sidebar.
- Hiding the real derivative/bundle route status; mobile stays read-only while the
  authenticated desktop actions remain visible with useful loading, error, and
  retry states.
- A broad visual rebrand or an SDK upgrade mixed into the journey repair.
