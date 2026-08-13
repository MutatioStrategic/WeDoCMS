PRAGMA foreign_keys = ON;

-- Source and attribution fields keep demo media auditable when it is copied into R2.
ALTER TABLE assets ADD COLUMN source_url TEXT;
ALTER TABLE assets ADD COLUMN source_download_url TEXT;
ALTER TABLE assets ADD COLUMN source_license TEXT;
ALTER TABLE assets ADD COLUMN source_attribution TEXT;
ALTER TABLE assets ADD COLUMN demo_seed INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO assets (
  id, organization_id, owner_id, kind, status, title, description, caption,
  province, city, locality, landmark, subject_tags, cultural_tags,
  rights_status, model_release_status, property_release_status,
  authenticity_confidence, human_verified, workflow_stage, ai_tags,
  curator_notes, source_file_name, original_key, preview_key,
  metadata_review_status, metadata_review_note, metadata_provenance,
  source_url, source_download_url, source_license, source_attribution, demo_seed
) VALUES
(
  'asset-demo-table-mountain', 'org-demo', 'demo-contributor', 'image', 'published',
  'Table Mountain above Cape Town',
  'A real 2024 panorama of Table Mountain in Cape Town, Western Cape, sourced from Wikimedia Commons for local testing.',
  'Table Mountain, Cape Town, Western Cape, South Africa.',
  'Western Cape', 'Cape Town', 'City Bowl', 'Table Mountain',
  '["landscape","mountain","city","coast"]', '["South African landscape","Cape Town"]',
  'verified', 'not_required', 'not_required', 0.99, 1, 'approval',
  '["South Africa","Cape Town","Table Mountain","landscape"]',
  'Demo seed. Source licence and attribution are stored on the asset record.',
  'table-mountain-cape-town.jpg', 'originals/demo/table-mountain-cape-town.jpg', 'previews/demo/table-mountain-cape-town.jpg',
  'reviewed', 'Location is explicitly documented by the source record.', 'editor',
  'https://commons.wikimedia.org/wiki/File:Cape_Town_(ZA),_Table_Mountain_--_2024_--_2794%2B96%2B98%2B2800%2B01.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/1/14/Cape_Town_%28ZA%29%2C_Table_Mountain_--_2024_--_2794%2B96%2B98%2B2800%2B01.jpg',
  'CC BY-SA 4.0', 'Dietmar Rabich / Wikimedia Commons', 1
),
(
  'asset-demo-garden-route', 'org-demo', 'demo-contributor', 'image', 'published',
  'Garden Route landscape',
  'A real photograph of the Garden Route National Park in South Africa, sourced from Wikimedia Commons for local testing.',
  'Garden Route National Park landscape, South Africa.',
  'Eastern Cape', 'Knysna', 'Garden Route', 'Garden Route National Park',
  '["landscape","forest","coast","travel"]', '["South African landscape","Garden Route"]',
  'verified', 'not_required', 'not_required', 0.98, 1, 'approval',
  '["South Africa","Garden Route","Eastern Cape","landscape"]',
  'Demo seed. Source licence and attribution are stored on the asset record.',
  'garden-route-south-africa.jpg', 'originals/demo/garden-route-south-africa.jpg', 'previews/demo/garden-route-south-africa.jpg',
  'reviewed', 'Location is documented by the source record.', 'editor',
  'https://commons.wikimedia.org/wiki/File:Garden_Route_South_Africa.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/7/7d/Garden_Route_South_Africa.jpg',
  'CC BY-SA 4.0', 'Frankbel / Wikimedia Commons', 1
),
(
  'asset-demo-johannesburg-minibus', 'org-demo', 'demo-contributor', 'image', 'needs_review',
  'Minibus taxi in Maboneng',
  'A real street photograph from Maboneng, Johannesburg. It includes people and is intentionally seeded into the review queue.',
  'Minibus taxi in Maboneng, Johannesburg, Gauteng, South Africa.',
  'Gauteng', 'Johannesburg', 'Maboneng', NULL,
  '["transport","street","urban","community"]', '["South African city","Johannesburg","public transport"]',
  'editorial_only', 'pending', 'not_required', 0.96, 0, 'curator_correction',
  '["South Africa","Johannesburg","minibus taxi","review people"]',
  'Demo seed. Confirm model/personality rights before any commercial publication.',
  'johannesburg-minibus-maboneng.jpg', 'originals/demo/johannesburg-minibus-maboneng.jpg', 'previews/demo/johannesburg-minibus-maboneng.jpg',
  'needs_context', 'People may be identifiable; confirm release scope before publication.', 'contributor',
  'https://commons.wikimedia.org/wiki/File:2._Minibus_taxi_in_Maboneng,_Johannesburg,_South_Africa.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/5/54/2._Minibus_taxi_in_Maboneng%2C_Johannesburg%2C_South_Africa.jpg',
  'CC BY-SA 4.0', 'Shade Schutze Photography / Wikimedia Commons', 1
),
(
  'asset-demo-soweto-market', 'org-demo', 'demo-contributor', 'image', 'needs_review',
  'Soweto food market',
  'A real photograph of a food market in Soweto, Johannesburg. It is intentionally seeded as editorial-only pending context review.',
  'Food market in Soweto Township, Johannesburg, South Africa (2011).',
  'Gauteng', 'Johannesburg', 'Soweto', NULL,
  '["market","food","street","community"]', '["Soweto","South African everyday life","Johannesburg"]',
  'editorial_only', 'pending', 'not_required', 0.96, 0, 'curator_correction',
  '["South Africa","Soweto","market","review people"]',
  'Demo seed. Confirm model/personality rights before any commercial publication.',
  'soweto-market-2011.jpg', 'originals/demo/soweto-market-2011.jpg', 'previews/demo/soweto-market-2011.jpg',
  'needs_context', 'People may be identifiable; confirm release scope before publication.', 'contributor',
  'https://commons.wikimedia.org/wiki/File:Soweto_Market_2011.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/8/84/Soweto_Market_2011.jpg',
  'CC BY-SA 4.0', 'Nolabob / Wikimedia Commons', 1
),
(
  'asset-demo-simons-town-aerial', 'org-demo', 'demo-contributor', 'video', 'published',
  'Aerial view of Simon''s Town',
  'A 36-second real aerial video of the Red Hill Cannon in Simon''s Town, Cape Town, sourced from Wikimedia Commons for local video testing.',
  'Aerial view of the Red Hill Cannon in Simon''s Town, Cape Town, South Africa.',
  'Western Cape', 'Cape Town', 'Simon''s Town', 'Red Hill Cannon',
  '["video","aerial","coast","landmark"]', '["Cape Town","Simon''s Town","South African coast"]',
  'verified', 'not_required', 'not_required', 0.98, 1, 'approval',
  '["South Africa","Cape Town","Simon''s Town","aerial video"]',
  'Demo seed. Source licence and attribution are stored on the asset record.',
  'simons-town-red-hill-cannon.webm', 'originals/demo/simons-town-red-hill-cannon.webm', 'previews/demo/simons-town-red-hill-cannon.webm',
  'reviewed', 'Location, duration, and creator are documented by the source record.', 'editor',
  'https://commons.wikimedia.org/wiki/File:Aerial_view_of_the_Red_Hill_Cannon_in_Simons_Town,_Cape_Town,_South_Africa.webm',
  'https://upload.wikimedia.org/wikipedia/commons/3/34/Aerial_view_of_the_Red_Hill_Cannon_in_Simons_Town%2C_Cape_Town%2C_South_Africa.webm',
  'CC BY-SA 4.0', 'BallsyFPV / Wikimedia Commons', 1
),
(
  'asset-demo-cape-town-coastline', 'org-demo', 'demo-contributor', 'video', 'published',
  'Cape Town coastline',
  'A real free-to-use video of the Cape Town coastline, sourced from Pixabay for local video testing.',
  'Cape Town coastline and coastal road, Western Cape, South Africa.',
  'Western Cape', 'Cape Town', NULL, NULL,
  '["video","coast","landscape","road"]', '["Cape Town","South African coast","Western Cape"]',
  'verified', 'not_required', 'not_required', 0.98, 1, 'approval',
  '["South Africa","Cape Town","coastline","video"]',
  'Demo seed. Source licence and attribution are stored on the asset record.',
  'cape-town-coastline.mp4', 'originals/demo/cape-town-coastline.mp4', 'previews/demo/cape-town-coastline.mp4',
  'reviewed', 'Location, creator, and free-use status are documented by the source record.', 'editor',
  'https://pixabay.com/videos/south-africa-cape-town-coast-line-346332/',
  'https://cdn.pixabay.com/video/2026/04/14/346332_medium.mp4',
  'Pixabay Content License', 'lakegardaweddings / Pixabay', 1
);
