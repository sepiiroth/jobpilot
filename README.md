# JobPilot

Self-hosted job search assistant. Phase 0 provides tooling only; application services are not implemented yet.

## Setup

Use Node.js 24.22.1, pnpm 10.34.9, Docker Compose and gitleaks on your PATH.

```powershell
pnpm install
pnpm exec husky
Copy-Item .env.example .env
# Set POSTGRES_PASSWORD and VALKEY_PASSWORD in .env to unique local passwords.
pnpm lint
pnpm typecheck
pnpm test
docker compose up -d
docker compose ps
```

Hook activation is explicit to respect the project prohibition on assistant Git operations. The pre-commit hook fails closed when gitleaks is missing and scans staged changes before lint-staged. The commit-msg hook enforces Conventional Commits. Only the developer stages and commits files.

Apps: web, api, worker. Packages: shared, db, llm, sources, config. Frameworks and business logic are added in subsequent phases.

Mailpit UI: http://localhost:8025; SMTP: localhost:1025. Mailpit does not provide IMAP; phase 9 needs a separate IMAP test server or an approved alternative.

Only authorized APIs and user-owned email alerts are allowed. Scrapers violating terms of service are prohibited.

Licensed under AGPL-3.0-only. See LICENSE.

Host ports can be overridden with VALKEY_PORT, MAILPIT_HTTP_PORT and MAILPIT_SMTP_PORT in .env when the defaults are occupied.

## Phase 1: database and shared schemas

Set DATABASE_URL in .env to your local PostgreSQL connection string. Credentials must match the Compose variables. Never commit this file.

Run pnpm db:generate, pnpm db:migrate, pnpm lint, pnpm typecheck and pnpm test. Integration tests require Docker and create an isolated temporary PostgreSQL container. They do not use or erase your local database.

For the optional development seed, set SEED_PASSWORD_HASH in .env to an argon2id password hash, then run pnpm db:seed. This creates one explicitly fictional account (demo@example.invalid), one synthetic resume and two searches; rerunning does not duplicate them. Production seeding is refused.

Vectors have 1024 dimensions in this migration. Changing EMBEDDING_DIMENSIONS requires a matching schema migration, rebuilt indexes and recalculation of stored embeddings; changing an environment variable alone is insufficient. Zero and non-finite vectors are rejected. The similarity repository only returns offers linked to the requested user and excludes ignored matches.

Shared schemas are exported from @jobpilot/shared. Node-only SHA-256 deduplication helpers are exported separately from @jobpilot/shared/dedup to keep node:crypto out of future browser bundles.

## Phase 2: secure API

See [API setup and authentication](docs/api-authentication.md) for startup, account commands, CSRF, sessions, export and key rotation. Start with pnpm --filter @jobpilot/api start after configuring .env.

## Phase 3: web workspace

See [web setup and verification](docs/web.md) for the French Next.js shell, login, session protection, themes and client bundle checks. Run pnpm --filter @jobpilot/web dev alongside the API.

## Phase 4: container deployment

Follow [the CapRover deployment guide](docs/deployment-caprover.md) to configure the five apps and release images. The local smoke stack verifies isolated production containers without touching the normal development database.

## Phase 5: resumes, searches and settings

See [manual profiles and encrypted settings](docs/profiles-and-settings.md) for the resume editor, PDF export, search criteria, ATS companies and write-only credentials. Run `pnpm db:generate` and `pnpm db:migrate` before starting the updated API.
