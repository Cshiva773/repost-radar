-- 010_ownership_proof: what a creator can show for having made an original. The creator states where and when
-- they first published it; the fingerprint worker copies three EXIF fields from the file. Neither is verified,
-- so the review UI, the evidence pack and the notice label every value by its source.
ALTER TABLE assets ADD COLUMN first_published_url TEXT;
ALTER TABLE assets ADD COLUMN first_published_on DATE;
ALTER TABLE assets ADD COLUMN ownership_note TEXT;
-- EXIF DateTimeOriginal is the camera's own clock with no zone, so it stays a zoneless timestamp
ALTER TABLE assets ADD COLUMN exif_taken_at TIMESTAMP;
ALTER TABLE assets ADD COLUMN exif_artist TEXT;
ALTER TABLE assets ADD COLUMN exif_copyright TEXT;

-- The default templates gain the optional {{ownership_proof}} line (dropped from a notice when there is no proof),
-- but only while their body is still exactly the text 005 seeded: a template the creator edited is left alone
UPDATE notice_templates
   SET body = replace(body, 'A side-by-side comparison is attached.', E'A side-by-side comparison is attached.\n{{ownership_proof}}'),
       updated_at = now()
 WHERE md5(body) IN ('8f01f857fbd6531b67a13b32527f01da', 'f5a8a1a259917355b4f327b1262ea826');
