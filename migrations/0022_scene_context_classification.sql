-- A finer visual context keeps animal and plant close-ups from being flattened
-- into the broad rural_landscape location type. This remains pixel-derived and
-- must never be treated as geographic evidence.
ALTER TABLE assets ADD COLUMN scene_context TEXT NOT NULL DEFAULT 'unknown'
  CHECK (scene_context IN ('animal_close_up', 'plant_close_up', 'garden', 'field', 'mountain', 'street', 'shoreline', 'indoor_object', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_assets_scene_context ON assets(scene_context, status);
