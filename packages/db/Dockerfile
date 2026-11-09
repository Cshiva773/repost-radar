# Runs the SQL migrations once and exits, so a server needs no Node on the host.
# Build context is the repo root (see docker-compose.prod.yml)
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @repost-radar/db
COPY packages/db packages/db
USER node
CMD ["packages/db/node_modules/.bin/tsx", "packages/db/src/migrate.ts"]
