# Build context is the repo root (see docker-compose.yml)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/crawler/package.json apps/crawler/
RUN pnpm install --frozen-lockfile --filter @repost-radar/crawler...
COPY apps/crawler apps/crawler
RUN pnpm --filter @repost-radar/crawler build \
 && pnpm --filter @repost-radar/crawler deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
USER node
CMD ["node", "dist/index.js"]
