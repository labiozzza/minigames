-- MiniGames server schema (PostgreSQL). Applied by server/src/migrate.ts.
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id          text PRIMARY KEY,
  email       text UNIQUE,
  role        text NOT NULL DEFAULT 'player',
  created_at  bigint NOT NULL,
  guest_ids   jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL,
  expires_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS otps (
  email       text PRIMARY KEY,
  code_hash   text NOT NULL,
  expires_at  bigint NOT NULL,
  attempts    int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS otp_requests (
  email       text NOT NULL,
  ts          bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_requests_email_idx ON otp_requests(email, ts);

CREATE TABLE IF NOT EXISTS saves (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id     text NOT NULL,
  version     int NOT NULL,
  updated_at  bigint NOT NULL,
  active      jsonb,
  data        jsonb NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

-- Dedup key for sync events; the DB enforces concurrent idempotency.
CREATE TABLE IF NOT EXISTS seen_events (
  user_id     text NOT NULL,
  game_id     text NOT NULL,
  event_uuid  text NOT NULL,
  ts          bigint NOT NULL,
  PRIMARY KEY (user_id, game_id, event_uuid)
);

CREATE TABLE IF NOT EXISTS shares (
  code        text PRIMARY KEY,
  def         jsonb NOT NULL,
  owner       text,
  created_at  bigint NOT NULL,
  hits        int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS configs (
  game_id     text PRIMARY KEY,
  version     int NOT NULL,
  config      jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS config_drafts (
  game_id     text PRIMARY KEY,
  draft       jsonb NOT NULL,
  updated_by  text NOT NULL,
  updated_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS config_history (
  game_id     text NOT NULL,
  version     int NOT NULL,
  config      jsonb NOT NULL,
  archived_at bigint NOT NULL,
  PRIMARY KEY (game_id, version)
);

CREATE TABLE IF NOT EXISTS audit (
  id          bigserial PRIMARY KEY,
  ts          bigint NOT NULL,
  actor       text,
  action      text NOT NULL,
  game        text,
  detail      jsonb
);
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit(ts);

CREATE TABLE IF NOT EXISTS telemetry (
  id          bigserial PRIMARY KEY,
  user_id     text,
  ts          bigint NOT NULL,
  events      jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_ts_idx ON telemetry(ts);
