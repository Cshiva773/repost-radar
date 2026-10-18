-- 001_init: the nine tables from docs/ARCHITECTURE.md
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE platform_kind AS ENUM ('reddit');
CREATE TYPE candidate_status AS ENUM (
  'suppressed', 'pending', 'approved', 'dismissed', 'legitimate', 'escalated'
);

CREATE TABLE creators (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  contact_email TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A registered original and its three fingerprints
CREATE TABLE assets (
  id               BIGSERIAL PRIMARY KEY,
  creator_id       BIGINT NOT NULL REFERENCES creators(id),
  sha256           CHAR(64) NOT NULL,
  storage_key      TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  width            INTEGER,
  height           INTEGER,
  phash            BIT(64),
  pdq              BIT(256),
  embedding        VECTOR(512),
  fingerprinted_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (creator_id, sha256)
);
CREATE INDEX assets_embedding_hnsw ON assets USING hnsw (embedding vector_cosine_ops);

-- What the crawler polls; editable at runtime
CREATE TABLE watch_targets (
  id                BIGSERIAL PRIMARY KEY,
  creator_id        BIGINT NOT NULL REFERENCES creators(id),
  platform          platform_kind NOT NULL DEFAULT 'reddit',
  subreddit         TEXT NOT NULL,
  poll_interval_s   INTEGER NOT NULL DEFAULT 300 CHECK (poll_interval_s >= 60),
  last_seen_post_id TEXT,
  last_crawled_at   TIMESTAMPTZ,
  last_error        TEXT,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX watch_targets_live_unique
  ON watch_targets (creator_id, platform, lower(subreddit))
  WHERE deleted_at IS NULL;

-- One row per image seen, matched or not
CREATE TABLE crawled_posts (
  id               BIGSERIAL PRIMARY KEY,
  watch_target_id  BIGINT NOT NULL REFERENCES watch_targets(id),
  platform         platform_kind NOT NULL DEFAULT 'reddit',
  platform_post_id TEXT NOT NULL,
  author           TEXT,
  title            TEXT,
  url              TEXT NOT NULL,
  posted_at        TIMESTAMPTZ,
  storage_key      TEXT,
  phash            BIT(64),
  pdq              BIT(256),
  embedding        VECTOR(512),
  is_legitimate    BOOLEAN NOT NULL DEFAULT false,
  crawled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_post_id)
);

-- A crawled post scored against one asset
CREATE TABLE candidates (
  id               BIGSERIAL PRIMARY KEY,
  asset_id         BIGINT NOT NULL REFERENCES assets(id),
  crawled_post_id  BIGINT NOT NULL REFERENCES crawled_posts(id),
  hash_distance    INTEGER,
  embed_similarity REAL,
  confidence       REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status           candidate_status NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, crawled_post_id)
);
CREATE INDEX candidates_queue_idx ON candidates (status, confidence DESC);

-- Immutable audit of reviewer actions
CREATE TABLE decisions (
  id           BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL REFERENCES candidates(id),
  actor        TEXT NOT NULL,
  from_status  candidate_status NOT NULL,
  to_status    candidate_status NOT NULL,
  note         TEXT,
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decisions_candidate_idx ON decisions (candidate_id, decided_at);

CREATE TABLE notice_templates (
  id         BIGSERIAL PRIMARY KEY,
  platform   platform_kind NOT NULL,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE evidence_packs (
  id           BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL UNIQUE REFERENCES candidates(id),
  zip_key      TEXT NOT NULL,
  pdf_key      TEXT NOT NULL,
  notice_text  TEXT NOT NULL,
  template_id  BIGINT REFERENCES notice_templates(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ground truth for `make eval`
CREATE TABLE eval_labels (
  id                BIGSERIAL PRIMARY KEY,
  asset_id          BIGINT REFERENCES assets(id),
  probe_storage_key TEXT NOT NULL,
  transform         TEXT NOT NULL,
  is_match          BOOLEAN NOT NULL
);
