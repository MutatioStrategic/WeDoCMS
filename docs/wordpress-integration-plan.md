# WordPress connector delivery plan

## Product boundary

The WordPress connector is a publishing integration for licensed Veld Archive
media. WeDoCMS remains the source of truth for assets, contributor rights,
licences, releases, derivatives, payments, takedowns, and audit evidence.
WordPress stores either a reference to an approved hosted preview or a licensed
preview derivative. It does not create, edit, approve, license, or revoke Veld
assets.

## Release 1 user stories

### Epic A: Connection and tenant security

**A1 — Pair a WordPress site**

As an organisation administrator, I want to create a short-lived pairing code
for one WordPress site so that I can connect the site without pasting my Veld
password or browser session into WordPress.

Acceptance criteria:

- The code expires after ten minutes and is stored only as a hash.
- The code is single-use and bound to a normalized HTTPS site URL in production.
- Exchange creates a scoped connector token and never returns it again.
- An active duplicate connection for the same organisation and site is rejected.

**A2 — Revoke a site**

As an organisation administrator, I want to revoke one site connection so that
all future WordPress API calls fail immediately.

Acceptance criteria:

- Revoked tokens return HTTP 401.
- Revocation is recorded in the audit log.
- Existing WordPress attachments are not silently deleted.

**A3 — Protect the connector token**

As a site administrator, I want the plugin to store its token securely so that
database disclosure does not directly expose the connector credential.

Acceptance criteria:

- The Worker stores only a token hash.
- The plugin encrypts the token with a key derived from WordPress salts.
- The plugin uses capability checks, nonces, HTTPS API calls, and escaped output.
- Search and import requests are rate-limited and tenant-scoped.

### Epic B: Asset discovery

**B1 — Search Veld Archive from WordPress**

As a WordPress editor, I want to search approved Veld images from the WordPress
admin area so that I can select imagery without changing applications.

Acceptance criteria:

- Only published, human-reviewed, preview-backed records appear.
- Results show title, location, contributor, rights state, and licence state.
- Results exclude demo and production-blocked records.
- Search supports query, image kind, orientation, and usage filters.

**B2 — Explain why an image is usable**

As an editor, I want to see the active licence and expiry before inserting an
image so that I do not accidentally use editorial or expired material.

Acceptance criteria:

- An unlicensed result cannot be imported.
- Editorial-only media is not presented as commercial media.
- The UI links the editor back to the Veld licence workflow when payment is
  required.

### Epic C: Publishing

**C1 — Import a licensed preview derivative**

As a WordPress editor, I want to import an approved licensed preview into the
Media Library so that the image is served by my website and backed up with the
site content.

Acceptance criteria:

- The Worker rechecks paid, active licence, asset publication, and rights state
  immediately before delivery.
- The original media is never delivered by this endpoint.
- The plugin creates a WordPress attachment and stores Veld asset, licence,
  derivative, attribution, and expiry metadata.
- The plugin records an auditable usage event after successful import.

**C2 — Insert a hosted Veld image**

As an editor, I want a shortcode for a hosted approved preview so that I can
avoid duplicating media while retaining provenance.

Acceptance criteria:

- The shortcode contains no bearer token.
- It uses only the public transformed preview URL, never the original.
- The editor can see the associated asset and licence IDs in WordPress.

### Epic D: Rights operations

**D1 — Receive expiry warnings**

As a site administrator, I want the plugin to warn me before a licence expires
so that I can renew or replace the image.

Acceptance criteria:

- The Worker reports upcoming expiry and blocked usage states.
- WordPress polls on a bounded cron schedule.
- Notices are visible only to authorised administrators.

**D2 — Receive takedown and rights warnings**

As a site administrator, I want to know when an image becomes withdrawn or its
rights change so that I can review the affected pages.

Acceptance criteria:

- Notices identify the attachment, asset, and reason.
- The plugin never silently rewrites or deletes customer content.
- A future release may add an explicit administrator-approved replacement flow.

### Epic E: Operations and support

**E1 — Diagnose connection health**

As support staff, I want connection status, last seen time, plugin version, and
site URL so that I can troubleshoot without reading customer credentials.

Acceptance criteria:

- Token values are never displayed or logged.
- Connection activity is auditable and rate-limit failures are observable.

## Out of scope for Release 1

- Full WordPress-to-Veld two-way asset synchronisation.
- WordPress as the source of truth for rights or licensing.
- Automatic deletion of images from customer websites.
- Uploading arbitrary WordPress media into the marketplace.
- Video publishing through the first image connector.
- Replacing WordPress with a second CMS.

## Threat model and controls

| Threat | Control |
|---|---|
| Stolen pairing code | Ten-minute expiry, single use, site URL binding, hashed storage |
| Stolen connector token | Hash at Worker, encrypted plugin storage, revocation, scopes |
| Cross-tenant access | Connection resolves one organisation; all licence and usage queries use it |
| Unlicensed import | Paid active licence checked on every media request |
| Original-file leakage | Connector endpoint returns only preview derivative bytes |
| Takedown drift | Usage ledger plus periodic notices; no silent deletion |
| WordPress admin CSRF | Capability checks and WordPress nonces |
| XSS through metadata | Escaped admin and shortcode output |
| Abuse or scraping | Connection/IP rate limits and bounded result pages |

## Release gates

1. Typecheck and unit tests pass.
2. Migration smoke applies `0027_wordpress_connector.sql` in isolation and in
   sequence.
3. Pairing, single-use, revocation, tenant isolation, licence gating, and
   preview-only delivery have automated coverage.
4. PHP lint and WordPress coding/security review pass in a PHP-enabled CI job.
5. Staging verifies a real WordPress site, HTTPS-only production pairing,
   imported attachment metadata, hosted shortcode rendering, and expiry notice.
6. Production deployment verifies Worker version, remote migration, health,
   connection creation, token revocation, and media delivery.

## Later releases

- Gutenberg media sidebar and block insertion.
- Multi-site agency connection management.
- Explicit derivative selection and campaign handoff.
- Signed webhook delivery for urgent takedown notices.
- Approved replacement workflow.
