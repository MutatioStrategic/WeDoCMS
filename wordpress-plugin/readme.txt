=== Stockvel Connector ===
Contributors: stockvel
Tags: images, media library, licensing, stock photos, rights management
Requires at least: 6.2
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later

Search approved Stockvel imagery from WordPress, import licensed preview derivatives, or create a hosted shortcode while preserving licence provenance.

== Security boundary ==

Stockvel remains the source of truth for ownership, rights, licences, releases, derivatives, payments, and takedowns. This plugin does not upload WordPress media into the marketplace and never requests original media files.

Connector tokens are exchanged through a single-use, ten-minute pairing code. The token is stored encrypted using WordPress authentication salts. Revoke the connection from Stockvel or the plugin settings when the site is retired.

== Installation ==

1. Upload the `wordpress-plugin` folder as a plugin or zip its contents.
2. Activate **Stockvel Connector**.
3. In Stockvel, create a WordPress pairing code for this site's HTTPS URL.
4. In WordPress, open **Stockvel**, enter the API base URL and pairing code, and connect.
5. Search approved images. A paid, active licence is required before import or hosted usage.

== Publishing modes ==

* **Import to Media Library** downloads an approved preview derivative and stores asset, licence, variant, and import metadata on the attachment.
* **Get hosted shortcode** records usage and provides `[veld_archive_image]`. The shortcode uses only a public transformed preview URL and contains no secret.

The first release does not delete content when a licence expires or an asset is withdrawn. It displays an administrator notice so the page owner can renew, replace, or remove the image deliberately.

== Development ==

This connector is distributed separately from the Stockvel Worker and is tested against the versioned `/api/integrations/wordpress/v1` contract. PHP linting and a real WordPress staging test are required before production release.
