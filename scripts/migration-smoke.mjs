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
const foreignKeysSql = join(scratch, 'foreign-keys.sql');
writeFileSync(tablesSql, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('organizations','organization_memberships','auth_sessions','auth_security_events','notifications','rate_limit_buckets','media_scan_results','payment_webhook_events','payment_reconciliation_runs','rights_case_events','ops_actions','user_lightboxes','user_lightbox_members','licence_downloads','saved_searches','creator_profiles','portfolio_collections','asset_events','media_processing_jobs','licence_products','account_export_jobs','seller_onboarding_profiles','didit_webhook_events','marketplace_agreement_acceptances','payment_split_allocations') ORDER BY name;");
writeFileSync(foreignKeysSql, 'PRAGMA foreign_key_check;');

const tables = run(['wrangler', 'd1', 'execute', 'veld-archive', '--local', '--file', tablesSql]);

for (const required of [
  'organizations', 'organization_memberships', 'auth_sessions', 'auth_security_events',
  'payment_webhook_events', 'rights_case_events', 'user_lightboxes', 'user_lightbox_members',
  'licence_downloads', 'saved_searches', 'creator_profiles', 'portfolio_collections',
  'asset_events', 'media_processing_jobs', 'licence_products', 'account_export_jobs',
  'seller_onboarding_profiles', 'didit_webhook_events', 'marketplace_agreement_acceptances',
  'payment_split_allocations',
]) {
  if (!tables.includes(required)) throw new Error(`Required migrated table missing: ${required}`);
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
