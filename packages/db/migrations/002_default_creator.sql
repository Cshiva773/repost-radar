-- 002_default_creator: v1 has one creator who is also the reviewer (see docs/PRD.md#users)
INSERT INTO creators (id, name) VALUES (1, 'Demo creator') ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('creators', 'id'), GREATEST((SELECT MAX(id) FROM creators), 1));
