PRAGMA foreign_keys = ON;

ALTER TABLE payout_batches ADD COLUMN organization_id TEXT;
UPDATE payout_batches SET organization_id = 'org-demo' WHERE organization_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payout_batches_org ON payout_batches(organization_id, created_at DESC);
