# Veld Archive UX process flows

These flows define the minimum product journeys covered by browser QA. The solid path must work in the live read-only demo; authenticated write steps require the Worker and D1 resources.

## App shell and role handoff

The native Expo client on `better-2` and the Cloudflare web client on `main`
share actor intent and Worker contracts but use platform-appropriate shells.
Anonymous users can explore approved media, then choose **Create buyer account**
or **Sell your media**. Protected actions open authentication in context, retain
the selected asset or upload destination, and resume after the verified session
exchange.

The web sidebar is role-aware: buyers see Buyer home and Media studio, sellers
see Seller home with **+ Upload media**, and editors/admins see authorized review
and governance surfaces. Expo maps the same intent to native tabs: buyers get
Buyer, sellers get Upload with a central plus action, and editors/admins get a
review-capable upload entry point. Neither client presents a role-gated
destination as a dead-end page.

## Explore and search

```mermaid
flowchart LR
  A[Landing page] --> B[Enter a story brief]
  B --> C[Search archive]
  C --> D{Content API available?}
  D -->|yes| E[Keyword or semantic results]
  D -->|no| F[Demo archive fallback]
  E --> G[Filter media type]
  F --> G
  G --> H[Open asset evidence]
  H --> I[Inspect rights, provenance, match signals]
  I --> J[Buy/licence media or save lightbox]
```

Video previews show a distinct `VELD ARCHIVE · PREVIEW / NOT LICENSED FOR USE`
watermark. The Worker never falls back to an original video for an anonymous or
unpaid viewer; once a paid entitlement is confirmed, the authenticated viewer
can play the original through the preview route and download it from the
licensed workspace.

## Identity and workspaces

```mermaid
flowchart TD
  A[Shared app shell] --> B{Authenticated?}
  B -->|no| C[Public explore/search + Buy or Sell CTA]
  C --> D[Inline auth retains intent and destination]
  B -->|yes| E[Role-aware workspace navigation]
  D --> E
  E --> F{Role}
  F -->|contributor| G[Seller home + Upload]
  F -->|buyer| H[Buyer home + direct licence checkout]
  F -->|editor/admin| I[Review and governance queue]
```

### Password recovery

1. A visitor opens the email sign-in form and chooses **Forgot password?**.
2. The app sends the email address to Supabase and always shows the same
   confirmation whether an account exists. The app does not store reset tokens
   or passwords.
3. The visitor follows the single-use link back to the web origin or the native
   `veldarchive://auth/recovery` route. The app shows only the new-password form
   while Supabase holds the verified recovery session.
4. After the password is updated, the recovery session is signed out and the
   visitor is returned to sign-in. Expired or unavailable links show the provider
   error and offer a path to request another link.

### South African phone OTP

1. A visitor chooses **SMS** and enters a South African mobile number in the
   familiar local format, for example `073 712 3456`. The form explains that
   `+27` is added automatically; users do not need to type it.
2. The client validates the number, converts it to canonical `+27…` E.164,
   and asks Supabase for a six-digit SMS code. Invalid country codes,
   landlines, and malformed numbers are rejected before an SMS request.
3. If Supabase has no SMS provider configured, the form explains that an
   administrator must enable Phone authentication and an SMS provider in the
   Supabase project. The entered number remains available for correction and
   retry.
4. After verification, the Worker accepts only a South African phone claim
   and exchanges the verified Supabase identity for the normal Veld session.

## Buyer licence validation

1. A signed-in buyer opens any published asset from Explore, Search, or the Buyer ROI workspace.
2. The buyer chooses a licence type, territory, and duration, then runs the
   server-side validation check.
3. The Worker returns approval, rights-scope, model-release, and property-release
   checks plus the current price. The UI shows every check before any request
   is created.
4. If a check fails, the buyer can change the intended use or open the
   resolution desk. If all checks pass, the buyer reads and explicitly accepts
   the versioned Buyer Licence and Payment Terms. The purchase action then
   creates or reuses the pending licence contract and immediately opens hosted
   payment; this is not a manual access request.

5. The account purchase history shows pending contracts with a clear “Continue
   to payment” action. Retrying the same purchase reuses the existing pending
   contract rather than creating a duplicate. If the payment provider is
   unavailable, the pending contract remains visible and the UI explains that
   no charge was made.

6. The buyer may enable Auto-approval for their own new requests by checking
   the sign-off acknowledgement and saving it. Auto-approval applies only
   after the same server-side rights and release checks pass; it does not
   bypass pricing, payment, or original-file access. The setting is auditable
   and can be revoked at any time.

7. The buyer sees a purchase description for the selected licence type, the
   territory and duration being priced, the amount or custom-quote path, and
   the fact that a verified payment webhook is required before original access.
   The CEO/admin ledger shows the buyer sign-off, terms version, revocation,
   auto-approved requests, and paid versus unpaid status for the organisation.

The unavailable-backend state explains whether a pending licence was already
created, confirms that no charge was made, and offers a retry. A missing
published-asset state sends the buyer back to approved archive search.

## Buyer campaign-pack approval

1. A signed-in buyer opens a campaign workspace and sees the current buyer
   licence and payment terms directly above the ranked source photos.
2. The buyer must open the terms, then explicitly accept the displayed
   versions. The acceptance is recorded against that campaign and buyer.
3. Until that acceptance succeeds, **Approve for pack** remains disabled and
   the Worker rejects direct approval requests as well.
4. Rights warnings and provenance remain visible on each source before the
   buyer approves it. A failed acceptance or unavailable backend leaves the
   source unapproved and offers a retry.

## Buyer purchase history, membership, and credits

1. A signed-in buyer opens the Buyer ROI workspace and sees the complete
   purchase history, including licences, photographer subscriptions, monthly
   membership payments, and credit purchases.
2. The buyer chooses a membership start date and billing day from 1 to 28,
   then opens hosted payment checkout for the configured R1,200 monthly Paystack plan.
3. The membership remains pending until the signed payment webhook confirms
   payment. A confirmed payment activates the membership and records the next
   monthly charge date; a failed payment shows a past-due state.
4. The buyer enters a whole number of credits and opens hosted checkout. Each
   credit costs R100, and credits are added to the buyer ledger only after the
   signed payment webhook confirms payment.
5. The buyer can cancel a pending or active membership. Credit balances and
   transaction history remain visible for future custom licences agreed with
   artists.

The unavailable-backend state does not show cached money or credit balances and
offers a retry. Checkout routes fail closed when the payment provider is not
configured, and payment success is never inferred from the browser redirect.
The explicitly marked demo environment uses a server-side simulated provider
for licence walkthroughs only; production licences still require a signed
provider webhook before they become paid.

## Signup, introductory photos, and access choice

1. A visitor opens **Create an account** from an artist-approved free photo or
   the Subscribe CTA. Email confirmation (or South African phone OTP) is
   required before any allowance can be claimed.
2. After sign-in, the account surface shows a server-authoritative allowance
   of three free photo downloads. The Worker atomically claims one published
   artist-approved photo per buyer and asset; retries do not spend another
   download, and the limit cannot be bypassed by browser storage or a client
   counter.
3. When the allowance is exhausted, the buyer sees the evidence and next
   action: buy a once-off download bundle or choose unlimited monthly/annual
   access. Paystack webhook confirmation remains the source of truth for paid
   entitlements.
4. During upload, an artist can opt an image into the introductory offer.
   Video, unpublished, rights-pending, or withdrawn records are never eligible;
   editorial approval remains the publication gate.

## Contributor to publication

The native Expo route begins with seller account creation by email confirmation or phone OTP. Email confirmation returns through `veldarchive://auth/confirmed`; the verified email or phone identity is exchanged for a short-lived Veld API session and a new seller account is provisioned as a contributor. Existing memberships are never upgraded from a client-provided seller intent. Phone-only accounts use the verified phone as the identity and must collect a real contact email before workflows that require email delivery.

```mermaid
sequenceDiagram
  participant C as Contributor
  participant UI as Veld UI
  participant API as Worker API
  participant DB as D1
  C->>UI: Complete profile and seller tender
  UI->>API: Submit authenticated forms with CSRF token
  API->>DB: Create tender and asset record
  API-->>UI: Pending review confirmation
  C->>UI: Submit metadata and media
  UI->>API: Create asset / upload session
  API->>DB: Scan upload and advance media revision
  API-->>UI: AI enrichment queued once for this new image revision
  API->>DB: Store description, visible setting, category, attributes and visible text as suggestions
  C->>UI: Review/correct suggestions and evidence-backed location
  UI->>API: Save reviewed metadata revision
  Note over C,API: Later corrections never invoke AI again; retries reuse the original upload job
  C->>UI: Approve reviewed revision
  API->>DB: Add approved revision to FTS5 and queue Vectorize upsert
  API-->>UI: Published; index current or pending
  C->>UI: Check contributor insights
```

On mobile, the seller tender is split into three recoverable steps: contributor profile, individual/company identity verification, then signed contract and payout setup. Company verification uses CIPC before the hosted Didit session. Contract submission uses a transient Turnstile token and Firma reference; payout stores only the provider account reference and optional last-four values. When any provider is unavailable, the completed data remains stored, the failed step explains what happened, and the user can retry without creating a duplicate identity or contract implicitly.

## Top-admin approval ledger

```mermaid
flowchart TD
  A[Admin workspace] --> B[Open Admin ledger]
  B --> C{Approval API available?}
  C -->|yes| D[View all user-account and image sign-offs]
  C -->|no| E[Explain unavailable ledger state]
  D --> F[Filter all, user accounts, or images]
  F --> G[Inspect actor, subject, decision, resource, and proof state]
  G --> H{Record source}
  H -->|signed audit| I[Show hash, stream sequence, and verification status]
  H -->|legacy workflow| J[Show visible workflow record without signed-proof claim]
```

## Rights case

```mermaid
flowchart LR
  A[Open resolution case] --> B[Enter asset ID and evidence]
  B --> C[Choose remedy and mediation]
  C --> D[Submit]
  D --> E{Authenticated API available?}
  E -->|yes| F[Create case ID and notify reviewers]
  E -->|no| G[Explain required sign-in/backend]
  F --> H[Review, mediate, or appeal]
```

## QA acceptance criteria

- Every navigation control changes view or gives a clear prerequisite message.
- Search submits on Enter and button click; suggestion chips never submit the form accidentally.
- Search results remain useful when the read-only API is unavailable.
- Asset cards open a detail/evidence modal and the modal closes by close button, backdrop, and Escape.
- Buyer checkout stays in the asset evidence flow: validation, versioned terms, hosted payment, pending retry, and webhook-confirmed delivery are all explicit.
- Seller surfaces expose one primary upload action, preserve media/metadata on recoverable errors, and report that approval is required before search visibility.
- Protected workflows explain sign-in and backend requirements rather than silently failing.
- Form validation prevents incomplete submissions and successful actions show confirmation state.
- AI may classify a visible setting such as `market_scene`; only seller, EXIF, or editor evidence may populate geographic location fields.
- Approval is unavailable until the current metadata revision is explicitly reviewed, and buyer search ignores stale revisions.
- The top-admin ledger lists user-account and image approval/sign-off events with actor, subject, decision, resource, source, and integrity state.
