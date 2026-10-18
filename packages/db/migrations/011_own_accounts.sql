-- 011_own_accounts: the creator's own accounts on each platform, as "platform:handle" (lower case, no @ or u/).
-- A match on a post from one of them is marked as the creator's own post and cannot be approved, so a creator
-- never files a notice against themselves.
ALTER TABLE creators ADD COLUMN own_accounts TEXT[] NOT NULL DEFAULT '{}';
