-- Idempotent launch-readiness fixtures for the org-demo production smoke tenant.
-- These records are explicitly labelled as operational validation data.

INSERT OR IGNORE INTO users (
  id, email, display_name, role, onboarding_status, status
) VALUES (
  'demo-editor', 'review.editor@stockvel.local', 'Stockvel Review Editor', 'editor', 'approved', 'active'
);

INSERT INTO organization_memberships (
  id, organization_id, user_id, role, status, invited_by
) VALUES (
  'membership-demo-editor', 'org-demo', 'demo-editor', 'editor', 'active', 'demo-admin'
) ON CONFLICT(organization_id, user_id) DO UPDATE SET
  role = 'editor',
  status = 'active',
  updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO audit_logs (
  id, actor_id, action, entity_type, entity_id, metadata_json
) VALUES (
  'audit-demo-editor-bootstrap-20260819',
  'demo-admin',
  'editor_membership_bootstrapped',
  'user',
  'demo-editor',
  '{"purpose":"production-role-flow-validation","tenant":"org-demo","fixture":true}'
);

INSERT OR IGNORE INTO campaigns (
  id, organization_id, owner_id, name, brief_text, brief_json, brand_kit_json, status
) VALUES (
  'campaign-live-ai-validation-20260819',
  'org-demo',
  'demo-buyer',
  'Production campaign intelligence validation',
  'An editorial travel campaign for web and Instagram featuring authentic South African landscapes. Audience: international travellers. Industry: tourism. Editorial usage. Landscape and square formats.',
  '{"audience":"international travellers","platforms":["web","instagram"],"locations":["South Africa"],"tone":["authentic","editorial"],"industry":"tourism","productService":"South African travel","usageRights":"editorial","licenceType":"editorial","modelReleaseRequired":false,"formatNeeded":["landscape","square"],"keywords":["travel","south","africa","landscape","authentic"]}',
  '{"colours":[],"logoNotes":"","tone":"authentic editorial","industry":"tourism","forbiddenStyles":[],"preferredVisuals":"Natural South African landscapes with clear rights evidence"}',
  'active'
);

INSERT INTO campaign_assets (
  campaign_id, asset_id, stage, note
) VALUES (
  'campaign-live-ai-validation-20260819',
  'asset-demo-table-mountain',
  'approved',
  'Operational fixture proving campaign recommendation, rights and manifest flow.'
) ON CONFLICT(campaign_id, asset_id) DO UPDATE SET
  stage = 'approved',
  note = excluded.note,
  updated_at = CURRENT_TIMESTAMP;

INSERT OR IGNORE INTO audit_logs (
  id, actor_id, action, entity_type, entity_id, metadata_json
) VALUES (
  'audit-campaign-ai-validation-20260819',
  'demo-buyer',
  'campaign_created',
  'campaign',
  'campaign-live-ai-validation-20260819',
  '{"purpose":"production-campaign-intelligence-flow-validation","fixture":true}'
);
