import { readFile } from "node:fs/promises";

const path = new URL("../wordpress-plugin/veld-archive-connector.php", import.meta.url);
const source = await readFile(path, "utf8");
const required = [
  "Plugin Name: Stockvel Connector",
  "register_activation_hook",
  "wp_nonce_field('veld_archive_pair')",
  "current_user_can('manage_options')",
  "openssl_encrypt",
  "Authorization",
  "wp_remote_retrieve_response_code",
  "_veld_archive_asset_id",
  "/api/integrations/wordpress/v1/usages",
  "add_shortcode('veld_archive_image'",
];
const failures = required.filter((value) => !source.includes(value));
if (/error_log\s*\(/i.test(source) || /var_dump\s*\(/i.test(source)) failures.push("debug output");
if (/token[^\n]*(echo|print|var_dump|error_log)/i.test(source)) failures.push("token logging");
if (failures.length) {
  console.error(`WordPress plugin smoke failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("WordPress plugin smoke passed: secure pairing, capability/nonce checks, encrypted token storage, usage recording, and shortcode hooks are present.");
