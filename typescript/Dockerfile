FROM oven/bun:1.2 AS base
WORKDIR /app

# Install deps
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/client apps/client
COPY tsconfig.json biome.json ./

# Build client
RUN cd apps/client && bunx vite build

# Production image
FROM oven/bun:1.2-slim
WORKDIR /app

COPY --from=base /app/packages/shared packages/shared
COPY --from=base /app/apps/server apps/server
COPY --from=base /app/apps/client/dist apps/client/dist
COPY --from=base /app/node_modules node_modules
COPY --from=base /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "apps/server/src/index.ts"]
