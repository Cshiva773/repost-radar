-- 007_api_tokens: personal access tokens for the browser extension and scripts. Like sessions, only the
-- token's SHA-256 is stored; a token is shown once when created and can be revoked.
CREATE TABLE api_tokens (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   CHAR(64) NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);
