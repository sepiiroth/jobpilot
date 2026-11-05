# Changelog

## Unreleased

- Bootstrap phase 0 workspace, shared tooling, local infrastructure and contributor documentation.
- Validate local services and staged secret rejection; fix Valkey health authentication and allow local port overrides.

- Add phase 1 Prisma models, tenant-safe relationships, pgvector migrations, shared Zod schemas, development seed and isolated integration tests.

- Add phase 2 NestJS API, signed CSRF protection, Argon2id authentication, database sessions and Valkey rate limits.
- Add account commands, export and deletion, AES-GCM key rotation, health checks and development OpenAPI.
- Add HTTP security, credential-log redaction and ownership isolation tests with coverage enforcement.
- Verify API startup and health against the pinned Node.js 24.22.1 runtime.

- Add phase 3 Next.js workspace with French navigation, responsive layouts, themes and empty dashboard.
- Add shared authentication responses and a typed API client with cookie sessions and CSRF renewal.
- Add nonce-based CSP, browser bundle credential checks and login accessibility verification.

- Apply the approved Sonner type annotation fix for strict optional properties.

- Verify production web startup on Node.js 24.22.1 and login accessibility at 100/100.

- Add phase 4 multi-stage Docker images, standalone web output, API startup migrations and idle worker readiness.
- Add a pinned, tag-triggered release workflow with critical vulnerability scanning before publication.
- Document CapRover setup, registry access, environment variables, account creation and rollback.

- Recover API and worker Valkey connections after transient startup or service interruptions.
