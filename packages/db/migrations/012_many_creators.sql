-- 012_many_creators: anyone can sign up and get a private space. Two things were still shared between creators.

-- 1. Crawled posts were stored once per platform post, so when a second creator watched an account the first already
-- watched, their crawl skipped every post already held and they never got matches. A crawled post now belongs to the
-- creator whose source found it; two creators watching the same account each hold (and match) their own copy.
ALTER TABLE crawled_posts ADD COLUMN creator_id BIGINT REFERENCES creators(id);
UPDATE crawled_posts cp SET creator_id = wt.creator_id FROM watch_targets wt WHERE wt.id = cp.watch_target_id;
ALTER TABLE crawled_posts ALTER COLUMN creator_id SET NOT NULL;
ALTER TABLE crawled_posts DROP CONSTRAINT crawled_posts_platform_platform_post_id_key;
ALTER TABLE crawled_posts ADD CONSTRAINT crawled_posts_creator_post_unique UNIQUE (creator_id, platform, platform_post_id);

-- 2. Notice templates had no owner, so every creator could read and edit the same templates. Existing rows belong to
-- the default creator (the .env admin's, who may have edited them). Rows with no creator are the pristine defaults
-- (005's text with 010's proof line), copied to each creator when they sign up; nobody can edit them.
ALTER TABLE notice_templates ADD COLUMN creator_id BIGINT REFERENCES creators(id) ON DELETE CASCADE;
UPDATE notice_templates SET creator_id = 1;
CREATE INDEX notice_templates_creator_idx ON notice_templates (creator_id, platform, updated_at DESC);
INSERT INTO notice_templates (creator_id, platform, name, subject, body) VALUES
(NULL, 'reddit', 'Reddit copyright notice', 'Copyright infringement notice: {{infringing_url}}',
$$To the Reddit copyright agent,

I am the copyright owner of the original image described below. The post at the following address reproduces it without my permission:

Infringing post: {{infringing_url}}
Posted by u/{{post_author}} in r/{{target_name}} on {{posted_at}}
Post title: {{post_title}}

Original work: a photograph I created, attached to this notice as original.{{original_extension}} (SHA-256 {{original_sha256}}). A side-by-side comparison is attached.
{{ownership_proof}}

I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.

The information in this notification is accurate, and under penalty of perjury, I am the owner, or an agent authorized to act on behalf of the owner, of an exclusive right that is allegedly infringed.

Please remove or disable access to the infringing material.

{{legal_name}}
{{mailing_address}}
{{contact_email}}

Signed: /{{legal_name}}/
Date: {{today}}
$$),
(NULL, 'bluesky', 'Bluesky copyright notice', 'Copyright infringement notice: {{infringing_url}}',
$$To the Bluesky copyright agent,

I am the copyright owner of the original image described below. The post at the following address reproduces it without my permission:

Infringing post: {{infringing_url}}
Posted by @{{post_author}} on {{posted_at}}

Original work: a photograph I created, attached to this notice as original.{{original_extension}} (SHA-256 {{original_sha256}}). A side-by-side comparison is attached.
{{ownership_proof}}

I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.

The information in this notification is accurate, and under penalty of perjury, I am the owner, or an agent authorized to act on behalf of the owner, of an exclusive right that is allegedly infringed.

Please remove or disable access to the infringing material.

{{legal_name}}
{{mailing_address}}
{{contact_email}}

Signed: /{{legal_name}}/
Date: {{today}}
$$);
