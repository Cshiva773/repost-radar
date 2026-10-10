-- 005_review: login, the reviewer's audit identity, evidence-pack bookkeeping and starter notice templates.

-- v1 has one admin, created from ADMIN_USERNAME / ADMIN_PASSWORD when the API starts
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  creator_id    BIGINT NOT NULL REFERENCES creators(id),
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

-- The cookie holds a random token; only its SHA-256 is stored, so a database leak yields no usable session
CREATE TABLE sessions (
  token_hash  CHAR(64) PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Contact details a takedown notice must carry (17 U.S.C. §512(c)(3))
ALTER TABLE creators ADD COLUMN legal_name TEXT;
ALTER TABLE creators ADD COLUMN mailing_address TEXT;

-- Set by the evidence worker when a pack cannot be built (for example an unresolved placeholder);
-- cleared when a pack is built. Lets the review UI say why there is no download yet.
ALTER TABLE candidates ADD COLUMN evidence_error TEXT;

CREATE INDEX candidates_crawled_post_idx ON candidates (crawled_post_id);

-- A pack keeps its stored notice text when the template it came from is deleted
ALTER TABLE evidence_packs DROP CONSTRAINT evidence_packs_template_id_fkey;
ALTER TABLE evidence_packs ADD CONSTRAINT evidence_packs_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES notice_templates(id) ON DELETE SET NULL;

CREATE INDEX notice_templates_platform_idx ON notice_templates (platform, updated_at DESC);

INSERT INTO notice_templates (platform, name, subject, body) VALUES
('reddit', 'Reddit copyright notice', 'Copyright infringement notice: {{infringing_url}}',
$$To the Reddit copyright agent,

I am the copyright owner of the original image described below. The post at the following address reproduces it without my permission:

Infringing post: {{infringing_url}}
Posted by u/{{post_author}} in r/{{target_name}} on {{posted_at}}
Post title: {{post_title}}

Original work: a photograph I created, attached to this notice as original.{{original_extension}} (SHA-256 {{original_sha256}}). A side-by-side comparison is attached.

I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.

The information in this notification is accurate, and under penalty of perjury, I am the owner, or an agent authorized to act on behalf of the owner, of an exclusive right that is allegedly infringed.

Please remove or disable access to the infringing material.

{{legal_name}}
{{mailing_address}}
{{contact_email}}

Signed: /{{legal_name}}/
Date: {{today}}
$$),
('bluesky', 'Bluesky copyright notice', 'Copyright infringement notice: {{infringing_url}}',
$$To the Bluesky copyright agent,

I am the copyright owner of the original image described below. The post at the following address reproduces it without my permission:

Infringing post: {{infringing_url}}
Posted by @{{post_author}} on {{posted_at}}

Original work: a photograph I created, attached to this notice as original.{{original_extension}} (SHA-256 {{original_sha256}}). A side-by-side comparison is attached.

I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.

The information in this notification is accurate, and under penalty of perjury, I am the owner, or an agent authorized to act on behalf of the owner, of an exclusive right that is allegedly infringed.

Please remove or disable access to the infringing material.

{{legal_name}}
{{mailing_address}}
{{contact_email}}

Signed: /{{legal_name}}/
Date: {{today}}
$$);
