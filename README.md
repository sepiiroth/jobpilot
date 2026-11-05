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
