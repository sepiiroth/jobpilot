FROM node:24.22.1-alpine3.24 AS base
WORKDIR /workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
RUN apk upgrade --no-cache && apk add --no-cache openssl ca-certificates libstdc++
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
RUN --mount=type=cache,id=jobpilot-pnpm,target=/pnpm/store pnpm --filter @jobpilot/api deploy --prod --frozen-lockfile /output
RUN test -f /output/node_modules/@jobpilot/db/src/generated/client.ts
RUN cd /output && node node_modules/prisma/build/index.js --version
FROM node:24.22.1-alpine3.24 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
RUN apk upgrade --no-cache && apk add --no-cache openssl ca-certificates libstdc++
COPY --from=build --chown=node:node /output ./
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=6s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "scripts/start-container.mjs"]

