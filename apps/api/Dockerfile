# Build context is the repo root (see docker-compose.yml)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
# Shared workspace package: its `prepare` script builds dist/ during install
COPY packages/platforms packages/platforms
RUN pnpm install --frozen-lockfile --filter @repost-radar/api...
COPY apps/api apps/api
RUN pnpm --filter @repost-radar/api build \
 && pnpm --filter @repost-radar/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
