-- 009_creator_time_zone: notices are signed and dated, so they use the creator's own date and clock
-- (an IANA zone such as Asia/Kolkata) rather than UTC. metadata.json keeps exact UTC timestamps.
ALTER TABLE creators ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';
