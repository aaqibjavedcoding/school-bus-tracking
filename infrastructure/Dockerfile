# syntax=docker/dockerfile:1.7
#
# Production image for the supported single-instance deployment: one Node.js
# process serving the Next.js web UI, the /api/v1 API and Socket.IO
# (see web/server.js and docs/deployment.md).
#
# Build context MUST be the repository root (the image spans npm workspaces):
#
#   docker build -f infrastructure/Dockerfile -t school-bus-tracking .
#
# No secrets are baked in: every runtime value comes from the environment
# (see infrastructure/.env.production.example).

# ---- Builder -------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install the full (deterministic, lockfile-pinned) dependency tree. The
# postinstall build is skipped here because workspace sources are copied in
# later layers; the shared-package build is run explicitly below so the
# Docker layer cache stays useful.
COPY package.json package-lock.json .npmrc ./
COPY web/package.json web/package.json
COPY mobile/package.json mobile/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci --ignore-scripts

# Compile the shared packages to their dist/ outputs. Every packages/*/tsconfig.json
# extends the root tsconfig.base.json, so it must be present before `tsc` runs.
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build:packages

# Compile the API server (web/dist) and the Next.js App Router bundle
# (web/.next) — the exact production build documented in docs/deployment.md.
COPY web ./web
RUN npm --prefix web run build

# ---- Runner --------------------------------------------------------------
# Keep the toolchain needed by `npm run db:migrate`/`db:seed` (ts-node and the
# TypeScript migration sources ship in the image so the documented migration
# path works unchanged), while scoping the dependency tree to the web
# workspace's closure — the React Native toolchain never runs in this image.
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3001

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY web/package.json web/package.json
COPY mobile/package.json mobile/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci --ignore-scripts -w @school-bus-tracking/web

# Built shared packages (dist/) and the web workspace.
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/web/package.json ./web/package.json
COPY --from=builder /app/web/.sequelizerc ./web/.sequelizerc
COPY --from=builder /app/web/tsconfig.json ./web/tsconfig.json
COPY --from=builder /app/web/tsconfig.server.json ./web/tsconfig.server.json
COPY --from=builder /app/web/tsconfig.build.json ./web/tsconfig.build.json
COPY --from=builder /app/web/next.config.js ./web/next.config.js
COPY --from=builder /app/web/security-headers.js ./web/security-headers.js
COPY --from=builder /app/web/security-headers.d.ts ./web/security-headers.d.ts
COPY --from=builder /app/web/instrumentation.ts ./web/instrumentation.ts
COPY --from=builder /app/web/server.js ./web/server.js
COPY --from=builder /app/web/server-build-check.js ./web/server-build-check.js
# TypeScript server sources and scripts are required by `npm run db:migrate`
# (sequelize-cli runs the TS migrations through ts-node).
COPY --from=builder /app/web/scripts ./web/scripts
COPY --from=builder /app/web/src ./web/src
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/web/.next ./web/.next

WORKDIR /app/web

# Local document storage (see LocalStorageProvider): a named volume mounted
# here keeps uploads across container replacements. Object storage is out of
# scope for the single-instance deployment.
RUN mkdir -p .document-storage && chown -R node:node .document-storage
VOLUME ["/app/web/.document-storage"]

USER node
EXPOSE 3001

# Liveness only — readiness (including database connectivity) is served at
# /api/v1/health/ready for an external orchestrator.
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/v1/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# npm run start -> cross-env NODE_ENV=production node server.js
CMD ["npm", "run", "start"]
