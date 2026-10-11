# Testing Repost Radar by hand

A checklist for trying every feature yourself. Automated checks already run in CI (`make gate4`, the **Live Bluesky** workflow); this is the human pass on top.

## 1. Start it

**Codespaces (recommended, nothing to install).** On GitHub: **Code › Codespaces › Create codespace on `topic/v1`**. The dev container asks for a 4-core / 16 GB machine and runs `scripts/codespace-up.sh` on start. The first start takes about 8–10 minutes, mostly building the worker's CPU torch image. When the terminal prints "Repost Radar is up", open the **Ports** tab and click the globe next to **Repost Radar UI** (port 3000).

**Your own machine.** Docker with about 6 GB of memory, Node 22+ with pnpm, then:

```bash
bash scripts/codespace-up.sh
```

Then open http://localhost:3000.

Either way you get 20 CC0 sample originals and 5 edited copies of them planted in a local fixture feed, so the review queue fills within a minute.

**Sign in** as `admin` with `ADMIN_PASSWORD` from `.env` (default `change-me-local-only`; change it in `.env` and run `docker compose up -d api` to rotate it).

## 2. Checklist

Tick each line as you go. "Expect" is what should happen.

### Sign-in
- [ ] A wrong password. Expect "Invalid username or password".
- [ ] The right password. Expect the Review page.
- [ ] Sign out, then open `/queue/pending` directly. Expect to land on sign-in, and to return there after signing in.

### Settings
- [ ] Fill in legal name, contact email and mailing address, then Save. Expect "Saved" and the yellow warning gone.

### Originals
- [ ] The 20 seeded images show, all **Ready**.
- [ ] Upload one of your own photos. Expect a per-file "OK", then **Processing** turning **Ready** within seconds.
- [ ] Upload the same file again. Expect "already registered".

### Review queue
- [ ] **Pending** shows 5 matches with confidence 95–100%, each with both thumbnails.
- [ ] Open one. Expect the original and the copy side by side, with PDQ distance, CLIP similarity and post details.

### Decisions
- [ ] Press **D** on a match. Expect it dismissed and the next match to open.
- [ ] Press **E** on one. Expect it to move to **Second look**; open it from there and dismiss it.
- [ ] Press **L** on one (legitimate use). Expect it closed for good.
- [ ] Press **A** on one. Expect the approval dialog with the §512(f) warning; **Approve** stays disabled until you tick the good-faith box.
- [ ] Approve it. Expect "Building the pack…", then **Download ZIP** and the notice.

### Evidence pack and notice
- [ ] Download the ZIP. Expect `original.*`, `copy.*`, `side_by_side.png`, `metadata.json`, `summary.pdf` and `notice.txt`. Open the PDF and the side-by-side.
- [ ] The notice has your legal name, email and address, the post link, and no `{{…}}` left.
- [ ] Add `{{legal_name}}` to the notice and **Save edits**. Expect it refused. Make a normal edit instead. Expect it saved.
- [ ] **Rebuild**. Expect a confirmation that edits will be replaced, then a fresh pack.
- [ ] The **Decided** tab lists everything you decided, with statuses.

### Templates
- [ ] Edit the Reddit template: click a placeholder on the right to insert it, then Save.
- [ ] Type `{{signature}}` (not a real placeholder) and Save. Expect "Unknown placeholder(s): {{signature}}".

### Sources (live Bluesky)
- [ ] Add a Bluesky account you know posts images, e.g. `@yourfriend.bsky.social`, every 5 minutes. Within a tick or two, expect **last checked** and **images seen** to update.
- [ ] Add a hashtag, e.g. `#photography`. Expect the same. If it shows an error mentioning HTTP 403, Bluesky is refusing unauthenticated search from this network (cloud machines, including Codespaces, can hit this); set `BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD` (an app password from Bluesky Settings) in `.env` and run `docker compose up -d crawler`.
- [ ] To see a live match: download an image from a recent post on a watched account, upload it under Originals, and wait for the next check. Expect it in Pending at about 100%.
- [ ] **Pause** and **Remove** a source. Expect checks to stop; matches already found stay.
- [ ] **Suggested from your matches** lists the fixture's crosspost subreddit (`r/repostradar_elsewhere`) once the planted matches are in.

### Browser extension (optional)
- [ ] Settings › **Browser extension tokens** › Create. Expect the token shown once, with Copy.
- [ ] Load `apps/extension` in Chrome (`chrome://extensions` › Developer mode › Load unpacked). In Options, enter the API URL and paste the token. On your own machine the URL is `http://localhost:3000/api`; in Codespaces, use the forwarded port 3000 address plus `/api`, with the port's visibility set to Public (the token still protects the API).
- [ ] Right-click an image on bsky.app › **Check against Repost Radar**. Expect the closest originals with confidence.
- [ ] Open the toolbar popup. Expect your approved match with **Copy notice** and the platform's copyright page.
- [ ] Revoke the token in Settings. Expect the extension to report it is no longer authorised.

## 3. If something looks wrong

- `docker compose ps`: every service should be up (`healthy` where it has a check).
- `docker compose logs --tail 100 api crawler fingerprint-worker`: errors are JSON lines with a message.
- `/metrics` (signed in): crawl request counts, queue depths and target errors.

Please note what you did, what you expected and what happened, and open an issue with the bug template.
