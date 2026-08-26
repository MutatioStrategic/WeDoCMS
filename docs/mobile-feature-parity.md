# Mobile feature parity

This matrix compares the native Expo client on `better-2` with the desktop application on `main`. Repository history contains an early mobile scaffold and the current authenticated shell, but no other branch contains a complete seller onboarding or feature-parity implementation to transplant.

| Journey | Expo client | Worker/API seam | Notes |
| --- | --- | --- | --- |
| Public explore and asset evidence | Native | `/api/discovery`, `/api/assets`, asset previews | Includes loading, empty, error, detail, provenance, rights, and confidence states. |
| Search, sorting, alerts, and facets | Native | `/api/assets`, `/api/assets/facets`, `/api/saved-searches` | Includes media type, province, category, human-review, keyboard, and saved-alert controls. |
| Seller account creation | Native | Supabase Auth, `/api/auth/exchange` | Email confirmation deep-links to `veldarchive://auth/confirmed`; only newly provisioned seller accounts receive the contributor role. |
| Seller profile, KYC/KYB, contract, payout | Native | `/api/onboarding*` | Supports individual/company, CIPC, hosted Didit, Firma reference verification, Turnstile, and Paystack subaccount capture. Provider failures remain visible and retryable. |
| Upload and submission status | Native images; web video handoff | upload-session and asset routes | Uses the platform image picker and the existing private, idempotent upload workflow. Native video capture is explained as a web media-studio handoff until signed Stream upload is exposed in the mobile contract. |
| Seller asset library and metadata | Native | `/api/my/assets`, `/api/assets/:id` | Editable core metadata and rights status; publication remains governed server-side. |
| Creators and community actions | Native | `/api/creators*`, `/api/community/*` | Read portfolios, create discussions, post replies, and inspect community content. Curator-only showcase management remains role-gated. |
| Lightboxes and marketplace controls | Native | `/api/lightboxes*`, `/api/licence-products`, `/api/buyer/*`, `/api/buyer-api-keys` | Create, share, delete, and inspect lightboxes; buyer/admin accounts can manage auto-approval and API keys. |
| Contributor and buyer insights | Native summary | `/api/analytics/contributor`, `/api/analytics/buyer` | Server-derived metrics only; unavailable APIs never show cached financial figures. Detailed exports remain desktop-only. |
| Buyer licensing and delivery | Native direct flow | `/api/checkout/validate`, `/api/legal/agreements`, `/api/checkout`, `/api/payments/:licenceId/session`, `/api/my/licences` | Asset detail keeps the buyer in one flow: evidence and rights checks, versioned terms, hosted payment, pending retry, signed-webhook status, then authenticated original delivery. |
| Account, alerts, data rights, licences | Native core path | `/api/account/*`, `/api/notifications`, `/api/my/licences` | Includes identity portal, preferences, export, deletion, alerts, and licence history. Pending purchases can resume hosted payment; paid records expose only the authenticated original route. |
| Buyer subscription | Native | `/api/subscription*` | Starts and manages hosted Paystack flows. Webhooks remain the source of truth. |
| Campaign boards and delivery | Native with backend boundary | `/api/campaigns*`, `/api/campaigns/:id/manifest` | Open campaigns, inspect recommendations, and view the auditable manifest. The current Worker does not expose derivative-editor or bundle routes, so mobile explains that unavailable state. |
| Editorial governance | Native | `/api/governance/assets*` | Editors/admins can select records, save title/caption/rights corrections, approve reviewed revisions, or reject records. |
| Rights cases and mediation intake | Native | `/api/rights/*` | Lodge takedown cases with evidence and mediation request; discussion replies and case messaging are available after sign-in. |
| Operational integrations | Native entry points | `/api/integrations/wordpress/pairing` and desktop routes | WordPress pairing and stakeholder reference are available; Zoho administration remains explicitly privileged and is not exposed through a client token. |
| Media studio and bundle editing | Desktop-only with mobile unavailable-state | derivative and bundle routes | Canvas editing and ZIP generation are not currently deployed as Worker contracts; mobile does not claim completion until those routes exist. |

## Release checks

- Configure the Supabase redirect allow list and public Turnstile site key.
- Verify signup with email confirmation on Android and iOS.
- Exercise individual and company onboarding with unavailable CIPC, Didit, Firma, Paystack, and Worker states.
- Verify contributor, buyer, editor, and admin navigation independently.
- Run `npm run mobile:typecheck`, `npm run test:mobile`, `npm run test:auth`, and the normal repository build gates before release.
