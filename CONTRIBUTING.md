# Contributing

Thanks for looking. Repost Radar is a small project, so the bar is: the change is focused, it is tested, and the phase gates stay green.

## Ground rules

- **A human approves every notice.** Changes that would send anything to a platform automatically, crawl beyond the sources a creator names, or profile people across platforms will not be merged (see the non-goals in [docs/PRD.md](docs/PRD.md)).
- **Platform terms come first.** A new adapter must use an official API within its published limits. Link the terms in your PR.
- **No secrets in the repo.** `.env` is gitignored; put new settings in `.env.example` with a safe local default.

## Setup

Docker, Node 22+ with pnpm (`corepack enable`), and [uv](https://docs.astral.sh/uv/) for the Python worker.

```bash
cp .env.example .env
pnpm install
pnpm -r typecheck && pnpm -r test     # TypeScript: API, crawler, web, shared packages
pnpm run test:py                      # Python worker
```

The UI can be developed without Docker: `pnpm --filter @repost-radar/web dev:mock`.

The phase gates (`make gate`, `gate1`, `gate2`, `gate4`) bring up the whole stack in Docker and check it end to end. CI runs `gate4`, which includes the others. The worker image builds CPU torch, so allow about 4 GB of memory for Docker.

## Where things live

| Path | What |
| --- | --- |
| `apps/api` | Fastify API (routes in `src/<area>/*Routes.ts`, SQL in `*Repository.ts`) |
| `apps/crawler` | Crawl loop and platform adapters (`src/platforms/<name>/`) |
| `apps/web` | Review UI (`src/pages`, mock API in `dev/mockApi.ts`) |
| `workers/fingerprint` | Python: fingerprinting, matching, evidence packs, evaluation |
| `packages/platforms` | Platform definitions shared by API and crawler |
| `packages/db` | SQL migrations (append a new numbered file; never edit an applied one) |
| `docs/` | PRD, architecture, build tasks, notes |

Adding a platform has its own guide: [docs/ADDING_A_PLATFORM.md](docs/ADDING_A_PLATFORM.md).

## Code style

Match the code around you:

- Names carry their context and type (`candidateList`, `watchTargetDetails`, `pageCount`); constants are `UPPER_CASE`.
- Functions stay small and stateless.
- Repositories catch database errors, log them with context and return `undefined` or `[]`.
- User-facing errors are specific; anything else is `"Something went wrong"`.
- Never log tokens or passwords.

## Pull requests

- One topic per PR, with a short **Why / What / Verification** description (the template has it).
- Add or update tests for behaviour you change. A change to scoring needs an evaluation run (`make eval` or the **Evaluation** workflow) and the numbers in the PR.
- Update the docs your change makes stale.

## Reporting security issues

Please use [private advisories](https://github.com/Cshiva773/repost-radar/security/advisories/new), not public issues.
