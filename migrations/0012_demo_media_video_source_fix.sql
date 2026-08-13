PRAGMA foreign_keys = ON;

-- 0011 was originally prepared with a Wikimedia video that may be rate-limited by
-- the seeder's network. Keep the migration chain correct for existing local DBs by
-- switching that one demo row to the verified Pixabay Cape Town coastline clip.
UPDATE assets SET
  title = 'Cape Town coastline',
  description = 'A real free-to-use video of the Cape Town coastline, sourced from Pixabay for local video testing.',
  caption = 'Cape Town coastline and coastal road, Western Cape, South Africa.',
  province = 'Western Cape',
  city = 'Cape Town',
  locality = NULL,
  landmark = NULL,
  subject_tags = '["video","coast","landscape","road"]',
  cultural_tags = '["Cape Town","South African coast","Western Cape"]',
  authenticity_confidence = 0.98,
  ai_tags = '["South Africa","Cape Town","coastline","video"]',
  source_file_name = 'cape-town-coastline.mp4',
  original_key = 'originals/demo/cape-town-coastline.mp4',
  preview_key = 'previews/demo/cape-town-coastline.mp4',
  source_url = 'https://pixabay.com/videos/south-africa-cape-town-coast-line-346332/',
  source_download_url = 'https://cdn.pixabay.com/video/2026/04/14/346332_medium.mp4',
  source_license = 'Pixabay Content License',
  source_attribution = 'lakegardaweddings / Pixabay',
  metadata_review_note = 'Location, creator, and free-use status are documented by the source record.',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'asset-demo-johannesburg-lightning';

UPDATE assets SET id = 'asset-demo-cape-town-coastline'
WHERE id = 'asset-demo-johannesburg-lightning';
