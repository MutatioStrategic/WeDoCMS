# Phase 3B + 3C CMS delivery

The campaign workspace now covers the bounded image-editing and handoff flow.

## Editing

- Open a campaign image from the campaign board.
- Choose square, portrait, landscape, Story, Reel cover, LinkedIn, web hero, or email header framing.
- Apply rotate, flip, straighten, brightness, contrast, saturation, warmth, background blur/extension, text, logo placement, safe margins, before/after, and rule-of-thirds/copy-safe guides.
- Save a recipe as a new `asset_edit_versions` row. The source asset and original R2 object are never updated.
- Rendered output is uploaded to R2 through `asset_derivative_exports` and remains linked to `source_asset_id`, `asset_id`, `edit_version_id`, `campaign_id`, `licence_id`, and the rights snapshot.

Derivative bytes are rejected unless the selected licence is paid, unexpired, attached to the source asset/campaign, and still passes the archive rights and release checks.

## Bundles

Bundle requests support `social_media`, `website`, `paid_ads`, `print_handoff`, and `full_archive`. A request remains `pending` until an authorised buyer/editor approves it. Approval rechecks campaign asset stage, licence validity, and derivative readiness, then writes an auditable ZIP to R2 containing:

- campaign brief and brand kit;
- derivative media;
- licence certificates;
- attribution text;
- metadata JSON and CSV;
- an approval/audit manifest.

Approved downloads expire after seven days. Bundle history exposes pending, approved, expired, revoked, and failed states.

Buyer approval is terms-gated: the buyer must open and accept the current buyer
licence and payment disclosures above the source photos. The acceptance is
stored for the campaign and rechecked by the Worker before an asset can move to
`approved`.

## Key API surface

- `GET/POST /api/campaigns`
- `GET /api/campaigns/:id`
- `POST /api/campaigns/:id/terms/accept`
- `POST /api/campaigns/:id/assets`
- `GET/POST /api/assets/:id/edit-versions`
- `POST /api/assets/:id/derivatives`
- `PUT /api/assets/:id/derivatives/:derivativeId/content`
- `GET/POST /api/campaigns/:id/bundles`
- `POST /api/campaigns/:id/bundles/:bundleId/approve`
- `GET /api/campaign-bundles/:id/download`
