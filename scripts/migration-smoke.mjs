import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args) {
  return execFileSync(npx, args, { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
}

run(['wrangler', 'd1', 'migrations', 'apply', 'veld-archive', '--local']);

const scratch = mkdtempSync(join(process.cwd(), '.migration-smoke-'));
const tablesSql = join(scratch, 'tables.sql');
const columnsSql = join(scratch, 'columns.sql');
const foreignKeysSql = join(scratch, 'foreign-keys.sql');
writeFileSync(tablesSql, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('organizations','organization_memberships','auth_sessions','auth_security_events','notifications','rate_limit_buckets','media_scan_results','payment_webhook_events','payment_reconciliation_runs','rights_case_events','ops_actions','user_lightboxes','user_lightbox_members','licence_downloads','saved_searches','creator_profiles','portfolio_collections','asset_events','media_processing_jobs','licence_products','account_export_jobs','seller_onboarding_profiles','didit_webhook_events','marketplace_agreement_acceptances','payment_split_allocations','audit_log_events','audit_exports','contributor_verification_cases','asset_edit_versions','asset_derivative_exports','campaign_bundles','stream_uploads','campaign_bundle_builds','buyer_free_downloads','buyer_platform_subscriptions','buyer_credit_purchases','buyer_credit_transactions') ORDER BY name;");
const requiredColumns = [
  'assets.free_download_enabled',
  'assets.license_credit_cost', 'assets.subscription_included',
  'licences.credit_cost', 'buyer_credit_purchases.purpose',
  'assets.stream_status', 'assets.stream_progress', 'assets.stream_error_code',
  'assets.stream_error_text', 'assets.stream_updated_at', 'assets.stream_ready_at',
  'audit_log_events.organization_id', 'audit_exports.organization_id',
  'audit_exports.created_by', 'contributor_verification_cases.organization_id',
  'webhook_subscriptions.secret_ciphertext', 'webhook_subscriptions.secret_iv',
];
writeFileSync(columnsSql, "SELECT " + requiredColumns.map((column) => {
  const [table, name] = column.split('.');
  return "(SELECT COUNT(*) FROM pragma_table_info('" + table + "') WHERE name = '" + name + "') AS \"" + column + "\"";
}).join(', ') + ";");
writeFileSync(foreignKeysSql, 'PRAGMA foreign_key_check;');

const tables = run(['wrangler', 'd1', 'execute', 'veld-archive', '--local', '--file', tablesSql]);

for (const required of [
  'organizations', 'organization_memberships', 'auth_sessions', 'auth_security_events',
  'payment_webhook_events', 'rights_case_events', 'user_lightboxes', 'user_lightbox_members',
  'licence_downloads', 'saved_searches', 'creator_profiles', 'portfolio_collections',
  'asset_events', 'media_processing_jobs', 'licence_products', 'account_export_jobs',
  'seller_onboarding_profiles', 'didit_webhook_events', 'marketplace_agreement_acceptances',
  'payment_split_allocations', 'audit_log_events', 'audit_exports', 'contributor_verification_cases',
  'asset_edit_versions', 'asset_derivative_exports', 'campaign_bundles', 'stream_uploads', 'campaign_bundle_builds', 'buyer_free_downloads',
  'buyer_platform_subscriptions', 'buyer_credit_purchases', 'buyer_credit_transactions',
]) {
  if (!tables.includes(required)) throw new Error(`Required migrated table missing: ${required}`);
}

const columnRows = JSON.parse(run(['wrangler', 'd1', 'execute', 'veld-archive', '--local', '--file', columnsSql, '--json']))
  .flatMap((result) => result.results ?? []);
const columns = columnRows[0] ?? {};
for (const required of requiredColumns) {
  if (Number(columns[required] ?? 0) !== 1) throw new Error(`Required migrated column missing: ${required}`);
}

try {
  const foreignKeys = run(['wrangler', 'd1', 'execute', 'veld-archive', '--local', '--file', foreignKeysSql]);
  if (/foreign_key_check\s+\S/i.test(foreignKeys)) {
    throw new Error(`Foreign-key check returned invalid rows: ${foreignKeys}`);
  }
  console.log('Migration smoke test passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
