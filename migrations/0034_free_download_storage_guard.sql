-- A free-download offer must point at an original object that can actually be delivered.
-- Older seed rows predate the media-key contract and must not advertise an unusable offer.
UPDATE assets
SET free_download_enabled = 0
WHERE free_download_enabled = 1
  AND (kind <> 'image' OR original_key IS NULL OR trim(original_key) = '');
