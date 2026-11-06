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
ARG NEXT_PUBLIC_API_URL
ARG APP_NAME=JobPilot
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV APP_NAME=$APP_NAME
RUN pnpm --filter @jobpilot/web build
RUN pnpm --filter @jobpilot/web verify:client
RUN --mount=type=cache,id=jobpilot-pnpm,target=/pnpm/store pnpm --filter @jobpilot/web deploy --prod --frozen-lockfile /output
FROM node:24.22.1-alpine3.24 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apk upgrade --no-cache && apk add --no-cache libstdc++
COPY --from=build --chown=node:node /output/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/connexion',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

