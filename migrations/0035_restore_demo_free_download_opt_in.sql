-- The storage guard in 0034 correctly disabled older offers whose original
-- keys were missing. The demo originals have since been restored to the
-- isolated demo bucket, so restore the two deliberate, rights-verified photo
-- candidates without creating paid credits for any buyer.
UPDATE assets
SET free_download_enabled = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN ('asset-demo-table-mountain', 'asset-demo-garden-route')
  AND organization_id = 'org-demo'
  AND demo_seed = 1
  AND kind = 'image'
  AND status = 'published'
  AND rights_status = 'verified'
  AND original_key IN (
    'originals/demo/table-mountain-cape-town.jpg',
    'originals/demo/garden-route-south-africa.jpg'
  );
