-- §14 admin publish metadata: checksum/revision/who/when/changed fields.
-- Idempotent so it is safe on databases created before the admin panel.
ALTER TABLE configs ADD COLUMN IF NOT EXISTS checksum text;
ALTER TABLE configs ADD COLUMN IF NOT EXISTS changes jsonb;
ALTER TABLE configs ADD COLUMN IF NOT EXISTS by_id text;
ALTER TABLE configs ADD COLUMN IF NOT EXISTS at bigint;

ALTER TABLE config_history ADD COLUMN IF NOT EXISTS checksum text;
ALTER TABLE config_history ADD COLUMN IF NOT EXISTS changes jsonb;
ALTER TABLE config_history ADD COLUMN IF NOT EXISTS by_id text;
ALTER TABLE config_history ADD COLUMN IF NOT EXISTS at bigint;
