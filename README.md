# JobPilot

Self-hosted job search assistant for authorized job collection, profile-based ranking, reviewed resume/letter drafts and application tracking. Includes optional UTC schedules, encrypted backups and tested recovery.

## Setup

Existing instances must follow the [database image migration procedure](docs/deployment-caprover.md) before restarting Compose with the new image variant. Take an encrypted backup and verify an empty-target restore first; operating-system/locale changes can require rebuilding collation-dependent indexes.

Use Node.js 24.22.1, pnpm 10.34.9, Docker Compose and gitleaks on your PATH.

```powershell
pnpm install --frozen-lockfile
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

Apps: web, api, worker. Packages: shared, db, llm, sources, config. The API verifies every session and ownership boundary; the worker handles collection, scoring, scheduling, retention and encrypted backups.

Mailpit UI: http://localhost:8025; SMTP: localhost:1025. IMAP integration tests use a separate disposable Dovecot server alongside Mailpit; see the phase 9 guide.

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

## Phase 6: AI and resume import

See [LLM configuration and PDF import](docs/llm-and-resume-import.md) for providers, review before saving, embedding states, quotas, endpoint policy and verification.

## Phase 7: job collection

See [collection setup and verification](docs/collection.md) for source configuration, manual runs, limits, progress, recovery and private offer embeddings. Run the API and worker alongside the web app.

## Phase 8: scoring and offers

See [scoring and offers](docs/scoring-and-offers.md) for the three-stage pipeline, persistent analysis limits, filters, status actions, dashboard summary and verification.

## Phase 9: email alerts

See [read-only email alerts](docs/email-alerts.md) for IMAP setup, authorized senders, private offers, UID tracking, TLS/network policy and verification with temporary Dovecot and Mailpit servers.

## Tailored documents

From an offer, generate and edit private resume and cover-letter drafts with tone, length and language controls. Master resumes stay unchanged. Flagged facts and rewritten text require explicit review before PDF export or letter copying. Each generated version displays its tokens and estimated cost. See [the generation guide](docs/generated-documents.md) for integrity rules, version history and setup.

## Application tracking

Track offers from the offer detail page, then manage notes, calendar dates and the exact resume/letter versions used in the **Candidatures** board. Cards support pointer dragging, keyboard dragging and a native status selector. Follow-up dates display an overdue badge without sending notifications. See [the application tracking guide](docs/application-tracking.md) for behavior, privacy and verification.

## Daily use and operations

Start with [the user guide and fictional screenshots](docs/user-guide.md). Configure optional per-user UTC schedules in Settings. Administrators should follow [encrypted backups and tested restoration](docs/operations-and-recovery.md), then complete [the publication checklist](docs/publication-review.md). Backups stay disabled until S3 and an age public recipient are configured. France Travail remains disabled.

The final automated checks include `pnpm test:e2e`, `pnpm verify:recovery` (after building the worker image), `pnpm audit --prod` and `pnpm osv:scan`. OSV receives only public npm package names and installed versions. No check sends resume or account data. All third-party dependencies retain their own licenses; the project's AGPL-3.0-only license applies to original project code.
