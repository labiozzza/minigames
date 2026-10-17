-- §15 analytics/notifications: anonymous analytics rows (user_id may be NULL),
-- structured push subscriptions. Live push delivery still needs deployment
-- credentials; this stores the subscription so delivery can be enabled later.
ALTER TABLE telemetry ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    text PRIMARY KEY,
  user_id     text NOT NULL,
  sub         jsonb NOT NULL,
  created_at  bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
