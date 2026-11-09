# Deploying a live install

One server runs the whole stack from `docker-compose.yml` plus `docker-compose.prod.yml`. [Caddy](https://caddyserver.com/docs/automatic-https) is the only part reachable from the internet: it serves HTTPS on ports 80/443 and gets and renews the certificate itself. Postgres, Redis, SeaweedFS, the API and the web container listen only on the server's private Docker network.

Sign-up is off: the operator (`ADMIN_USERNAME`) signs in, and `scripts/server-add-user.sh` gives anyone else their own private space. Turning `SIGNUP_ENABLED=true` on for strangers first needs password reset, email confirmation and a privacy policy (PRD, known gaps).

CI runs this exact setup on every change to it, on an ARM machine like Oracle's free one: `.github/workflows/deploy-smoke.yml` runs `scripts/server-setup.sh localhost`, then `scripts/deploy-smoke.sh`.

## What it needs

- Ubuntu 22.04 or 24.04, x86 or ARM, with about 4 GB of memory or more (the setup adds swap below 6 GB). [Oracle Cloud's Always Free Ampere A1 server](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) (2 CPUs, 12 GB) fits.
- An address that points at the server: your own domain with a DNS `A` record, or `<server-ip>.sslip.io` (no DNS to set up).
- Inbound TCP 80 and 443 allowed by the cloud provider's firewall.

## Oracle Cloud Always Free, step by step

Oracle's free allowance and limits: [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm). It can reclaim a free server that stays idle (CPU, network and memory all under 20%) for 7 days, and creating one can fail with "out of host capacity"; retry later or in another region. Console labels below may differ slightly.

1. Sign up for the Free Tier and pick a home region; Always Free servers can only be created there.
2. **Compute → Instances → Create instance**:
   - Image: Canonical Ubuntu 24.04.
   - Shape: Ampere `VM.Standard.A1.Flex`, 2 OCPUs, 12 GB memory.
   - Networking: a public subnet, with a public IPv4 address assigned.
   - SSH keys: paste the public key of the computer you will connect from.
3. Open the ports: **Networking → Virtual cloud networks →** your VCN **→** the public subnet **→** its security list **→ Add ingress rules**: source `0.0.0.0/0`, TCP, destination port `80`; and again for `443`.
4. Connect and set up (Oracle's Ubuntu user is `ubuntu`):

```bash
ssh ubuntu@<server-ip>
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/Cshiva773/repost-radar.git && cd repost-radar
bash scripts/server-setup.sh <server-ip>.sslip.io
```

Oracle's Ubuntu images block every inbound port but SSH in `iptables`; `server-setup.sh` opens 80 and 443 there too.

## What `server-setup.sh` does

Safe to re-run; each step skips what is already done.

1. Installs Docker Engine and Compose from [Docker's apt repository](https://docs.docker.com/engine/install/ubuntu/).
2. Adds a 2 GB swap file on servers with under 6 GB of memory.
3. Opens TCP 80/443 and UDP 443 in the server's own firewall.
4. Writes `.env` the first time, with fresh random passwords for Postgres, the image store and the operator, sign-up off and Bluesky as the only platform; later runs keep those secrets. `.env` is readable by its owner only.
5. Builds the images (10–20 minutes the first time), starts storage, creates the bucket, applies migrations, then starts everything with `restart: unless-stopped`, so services come back after a crash or reboot.
6. Adds the nightly backup (`/etc/cron.d/repost-radar-backup`, 03:30 UTC).
7. Waits until `https://<address>/api/health` answers.

The operator password is in `.env` on the server, never printed: `grep ^ADMIN_PASSWORD .env`.

## Day to day

| Task | Command (on the server, in `repost-radar/`) |
| --- | --- |
| Is everything healthy? | `bash scripts/server-status.sh`: services, HTTPS, each source's last crawl, last backup |
| Deploy what's on `main` | `bash scripts/server-update.sh`: pull, build, migrate, restart |
| Give someone an account | `bash scripts/server-add-user.sh friend@example.com "Their name"`: prints a random password once |
| Back up now | `bash scripts/server-backup.sh` |
| Restore a backup | `bash scripts/server-restore.sh backups/db/<date>.dump` |
| Logs | `docker compose logs -f api crawler fingerprint-worker` |

## Backups

`backups/db/<date>.dump` holds a full `pg_dump` per night, the last 7 kept. `backups/images/` mirrors the image bucket (originals, crawled images, evidence packs) as of the last run. Both sit on the same server, so they undo mistakes but not the loss of the server; copy `backups/` somewhere else for that.

## Background jobs

None of the app's own work needs cron. The crawler's timer checks due sources every `CRAWLER_TICK_SECONDS` (60), re-checks posts behind open matches every 5 ticks and deletes unmatched crawled images after `RETENTION_DAYS` about once an hour; the worker takes jobs from the Redis queue as they arrive. The nightly backup is the only cron entry.
