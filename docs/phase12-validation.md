# Phase 12 validation and changed files

The implementation adds optional per-user UTC collection scheduling, retention, encrypted S3 backups, an empty-target restore CLI, real-browser main-flow verification and a deliberately disabled France Travail boundary. Publication remains conditional on the two human checks in [the publication review](publication-review.md).

## Reproduce checks

Use Node.js 24.22.1 and pnpm 10.34.9 with Docker running. The normal development `.env` is required only by application startup/local migration commands; automated integration/browser/recovery tests provision their own isolated services and synthetic data.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm audit --prod
pnpm osv:scan
pnpm --filter @jobpilot/web build
pnpm --filter @jobpilot/web verify:client
pnpm exec playwright install chromium
pnpm test:e2e
```

Root workspace tests run in series to avoid resource contention between Docker suites. The browser test uses otherwise unused ports 3000 and 3001 and records synthetic screenshots under `docs/screenshots/`. Temporary credentials, traces and exported PDFs remain under ignored `.pnpm-store/` and are never publication artifacts.

Build and verify production/recovery separately:

```sh
pnpm db:image
docker build -f apps/api/Dockerfile -t jobpilot-api:phase12 .
docker build -f apps/worker/Dockerfile -t jobpilot-worker:phase12 .
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.invalid -f apps/web/Dockerfile -t jobpilot-web:phase12 .
pnpm verify:recovery
docker compose -p jobpilot-phase12-check -f docker-compose.smoke.yml up -d --wait --wait-timeout 180
docker compose -p jobpilot-phase12-check -f docker-compose.smoke.yml ps
docker compose -p jobpilot-phase12-check -f docker-compose.smoke.yml exec -T api id -u
docker compose -p jobpilot-phase12-check -f docker-compose.smoke.yml exec -T worker id -u
docker compose -p jobpilot-phase12-check -f docker-compose.smoke.yml exec -T web id -u
docker compose -p jobpilot-phase12-check -f docker-compose.smoke.yml down --volumes
```

Each Node service must report a nonzero UID. Smoke uses a separate Compose project with no published data ports; remove only that project's temporary volumes. See [recovery instructions](operations-and-recovery.md) for key custody and empty-database restoration, and [deployment instructions](deployment-caprover.md) before updating an existing database image/extension.

For normal development, after the documented database update and migration steps, run these in separate terminals:

```sh
pnpm --filter @jobpilot/api dev
pnpm --filter @jobpilot/worker start
pnpm --filter @jobpilot/web dev
```

No Git, GitHub API, image publication or CapRover deployment action is performed by these local checks. The deployment workflow is only authored for the maintainer.

## Recorded local results

Verified on 6 November 2026 with the final Alpine app images and custom database image:

| Check                                     | Result                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen installation and dependency audits | Passed; npm audit clean, OSV clean for 739 production package versions                                                                               |
| Encrypted backup / recovery               | Passed from Debian PostgreSQL 18 / vector 0.8.2 to an empty Alpine PostgreSQL 18.6 / vector 0.8.7 database; wrong key and populated targets rejected |
| Lint, TypeScript and formatting           | Passed                                                                                                                                               |
| Unit/integration suite                    | 194 tests, 7 successful workspace tasks; required coverage thresholds passed                                                                         |
| Production web build/client scan          | Passed; 26 client chunks contain no server credential references                                                                                     |
| Playwright main journey                   | 1 passed with Chromium 158.0.8127.18, desktop/mobile and keyboard tracking                                                                           |
| Production smoke                          | All five services healthy; Node UID 1000; native Argon2 login, Prisma access, CSRF and application state verified                                    |
| Strict Trivy image scans                  | All five images: 0 HIGH / 0 CRITICAL; no suppressions                                                                                                |

The source secret scan excludes local private configuration and generated artifacts; it cannot certify Git history. The two remaining publication gates are the maintainer's historical secret scan and an independent third-party clean installation. Automated cloud-storage tests use a simulated SDK transport; the encrypted archive and cross-distribution database restoration use real production tools.

## Image security checks

Run after building all four JobPilot images. These commands use a public scanner database and fail for HIGH or CRITICAL findings, including unfixed ones:

```sh
for image in jobpilot-api:phase12 jobpilot-worker:phase12 jobpilot-web:phase12 jobpilot-db:phase12 valkey/valkey:8-alpine; do
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v jobpilot-trivy-cache:/root/.cache/ aquasec/trivy:0.65.0 image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 "$image" || exit 1
done
```

On 6 November 2026 all five scans returned zero HIGH and zero CRITICAL findings. The custom PostgreSQL image uses Alpine su-exec 0.3-r0 instead of the upstream image's outdated Go-based gosu. CI checks Valkey; the release workflow scans the API, worker, web and custom database artifacts before publishing them. It does not deploy the database automatically.

## File manifest

No source file is deleted. New and modified phase files:

- `.env.example`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `apps/api/src/application.ts`
- `apps/api/src/auth/auth.integration.test.ts`
- `apps/api/src/email/email.integration.test.ts`
- `apps/api/src/settings/settings.controller.ts`
- `apps/api/src/settings/settings.repository.ts`
- `apps/web/messages/fr.json`
- `apps/web/src/components/profile/settings-page.tsx`
- `apps/web/src/lib/api-client.ts`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `apps/worker/Dockerfile`
- `apps/worker/package.json`
- `apps/worker/src/main.ts`
- `apps/worker/src/collection/runtime.integration.test.ts`
- `apps/worker/src/email/email.integration.test.ts`
- `apps/worker/src/operations/runtime.ts`
- `apps/worker/src/operations/backup.ts`
- `apps/worker/src/operations/backup.test.ts`
- `apps/worker/src/operations/restore.ts`
- `apps/worker/src/operations/restore-cli.ts`
- `apps/worker/src/operations/s3.ts`
- `apps/worker/src/operations/s3.test.ts`
- `apps/worker/src/testing/recovery-fixture.ts`
- `docker-compose.yml`
- `docker-compose.smoke.yml`
- `package.json`
- `pnpm-lock.yaml`
- `packages/db/Dockerfile`
- `packages/db/src/collection-repository.ts`
- `packages/db/src/vector.integration.test.ts`
- `packages/shared/package.json`
- `packages/shared/src/profile.ts`
- `packages/shared/src/operations.ts`
- `packages/shared/src/operations.test.ts`
- `packages/sources/src/index.ts`
- `packages/sources/src/types.ts`
- `packages/sources/src/france-travail.ts`
- `packages/sources/src/france-travail.test.ts`
- `scripts/verify-recovery.mjs`
- `scripts/e2e-server.mjs`
- `scripts/osv-scan.mjs`
- `e2e/setup.mjs`
- `e2e/main-flow.spec.mjs`
- `playwright.config.mjs`
- `docs/operations-and-recovery.md`
- `docs/publication-review.md`
- `docs/user-guide.md`
- `docs/deployment-caprover.md`
- `docs/phase12-validation.md`
- `docs/screenshots/login.png`
- `docs/screenshots/dashboard.png`
- `docs/screenshots/documents.png`
- `docs/screenshots/applications.png`
- `docs/screenshots/applications-mobile.png`
- `docs/screenshots/settings.png`
- `README.md`
- `CHANGELOG.md`
