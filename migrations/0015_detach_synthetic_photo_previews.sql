PRAGMA foreign_keys = ON;

-- Synthetic search records must not display unrelated demo media as visual evidence.
UPDATE assets
SET source_file_name = NULL,
    original_key = NULL,
    preview_key = NULL
WHERE id LIKE 'asset-test-photo-%'
  AND demo_seed = 0;
