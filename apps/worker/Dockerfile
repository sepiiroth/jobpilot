FROM node:24.22.1-bookworm-slim AS base
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.34.9
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY scripts/prepare.mjs ./scripts/prepare.mjs
RUN --mount=type=cache,id=jobpilot-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
FROM dependencies AS build
COPY . .
RUN pnpm --filter @jobpilot/db generate
RUN --mount=type=cache,id=jobpilot-pnpm,target=/pnpm/store pnpm --filter @jobpilot/worker deploy --prod --frozen-lockfile /output
RUN test -f /output/node_modules/@jobpilot/db/src/generated/client.ts
FROM node:24.22.1-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
ENV WORKER_HEALTH_PORT=3002
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /output ./
USER node
HEALTHCHECK --interval=30s --timeout=6s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||3002)+'/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]

