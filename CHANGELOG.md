# Changelog

## Unreleased

- Bootstrap phase 0 workspace, shared tooling, local infrastructure and contributor documentation.
- Validate local services and staged secret rejection; fix Valkey health authentication and allow local port overrides.

- Add phase 1 Prisma models, tenant-safe relationships, pgvector migrations, shared Zod schemas, development seed and isolated integration tests.

- Add phase 2 NestJS API, signed CSRF protection, Argon2id authentication, database sessions and Valkey rate limits.
- Add account commands, export and deletion, AES-GCM key rotation, health checks and development OpenAPI.
- Add HTTP security, credential-log redaction and ownership isolation tests with coverage enforcement.
- Verify API startup and health against the pinned Node.js 24.22.1 runtime.
