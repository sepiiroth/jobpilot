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

- Add phase 5 resume and search CRUD with authenticated ownership checks and section-based French forms.
- Add encrypted write-only credentials, provider preferences, ATS companies and stored IMAP configuration.
- Export master resumes as selectable single-column PDFs and verify text extraction and multi-page output.

- Add phase 6 provider-agnostic AI SDK module for API and worker with versioned untrusted-data prompts.
- Meter calls with atomic monthly token reservations, bounded retries and optional cost rates.
- Import PDFs into editable review drafts without changing master resumes.
- Calculate resume embeddings on save, preserve data on failure and invalidate stale vectors after settings changes.
- Add phase 7 BullMQ collection and embedding workers with durable run recovery and source rate limits.
- Collect and normalize authorized Adzuna, Greenhouse, Lever and Ashby APIs with anonymized fixture tests.
- Deduplicate offers, preserve ignored matches and isolate embeddings by user, model and content.
- Add protected collection endpoints, concurrent-start protection, SSE and French dashboard progress reports.

- Add phase 8 hard filtering, private-vector similarity and bounded AI scoring per search.
- Persist scoring attempt budgets across retries and fence stale results after profile edits.
- Add French offers filters, detailed analyses, interesting/ignored actions and dashboard summaries.
- Verify durable ignored states, tenant ownership, call limits and matching coverage thresholds.

- Add phase 9 read-only IMAP alerts with verified TLS, pinned DNS addresses and exact sender allowlists.
- Extract grounded vacancies through the configured small model with bounded MIME input and no automatic UID reprocessing.
- Keep email-derived offers private, preserve ignored states and include email state in account export/deletion.
- Validate real IMAP flags, certificate checks and the BullMQ pipeline with temporary Dovecot and Mailpit services.

- Add phase 10 private tailored resume and cover-letter drafts with immutable versions, cursor history and measured per-call costs.
- Add conservative integrity review for facts and free prose, fingerprint-bound approval, PDF exports and explicit letter copying.
- Add ownership, CSRF, master-preservation, stale-review and PDF extraction tests with enforced integrity coverage.

- Add phase 11 private application tracking with idempotent submitted-offer creation, revision-protected edits, notes and local calendar follow-up reminders.
- Add a French accessible dnd-kit board with keyboard/pointer dragging and native status selectors.
- Link reviewed immutable document versions, retain tracking after search deletion, and export application revisions in schema version 5.
