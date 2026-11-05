# Job collection

Phase 7 adds manual collection from authorized Adzuna, Greenhouse, Lever and Ashby APIs. Configure an active search attached to an active resume. For ATS boards, add companies with their board type and public token in Settings. Adzuna requires the two encrypted credentials in Settings. Missing configuration is reported per source; successful sources are retained.

Start API and worker after `pnpm db:generate` and `pnpm db:migrate`:

```powershell
pnpm --filter @jobpilot/api start
pnpm --filter @jobpilot/worker start
```

Use the dashboard collection button. Progress refreshes every three seconds. The report displays processed sources, offers found, new matches, duplicates and current embeddings, with source errors in French. Source selection applies to each active search. Email alerts are supported through the [phase 9 IMAP connector](email-alerts.md). Scoring and the offers list belong to phase 8.

## API and persistence

Authenticated, CSRF-protected `POST /collections` accepts an empty JSON object. Concurrent requests return the same active run. A PostgreSQL transaction lock and a partial unique index enforce one active run per user. After completion, the user's cooldown (or `COLLECTION_COOLDOWN_MINUTES`, default 30) applies. No eligible search returns 409; cooldown returns 429.

`GET /collections` returns the latest owned run or null. `GET /collections/:id` returns progress; `GET /collections/:id/events` provides SSE, bounded to one minute per connection. Foreign run IDs return 404. Clients may reconnect or poll. Responses contain counters and safe error codes, never search text or credentials.

The database commits the run and search/source snapshots before enqueueing. The worker recovers queued runs every ten seconds, so a queue outage does not lose committed work. Two-minute heartbeat leases and fencing tokens prevent a replaced worker from storing offers. Replayed steps use idempotent receipts. Collection and embedding jobs contain only owned record IDs; credentials are decrypted inside the worker. On shutdown, active workers close before database connections.

BullMQ registers `collection`, `embedding` and `scoring`. Only collection and embedding are consumed in phase 7. Additional `source-*` permit queues enforce source rates across workers sharing the same Valkey prefix. Do not share a prefix between independent installations or environments.

## Limits and normalization

`COLLECTION_MAX_REQUESTS=200` bounds actual HTTP attempts per run, `COLLECTION_MAX_OFFERS=500` bounds stored receipts, and `COLLECTION_MAX_PAGES=5` bounds paginated queries. Runs are bounded to ten minutes. Reaching a limit is reported rather than silently claiming complete results. ATS APIs without server filtering return board listings; relevance filtering is phase 8.

Source-specific rates are enforced in the worker. Adzuna is limited to one request per four seconds and `ADZUNA_DAILY_REQUEST_LIMIT=100` attempts per UTC day and hashed app ID across workers. Configure a lower allowance if required by your account; this setting grants no additional provider entitlement. Retries consume quota too. HTTP calls allow only the four fixed HTTPS API hosts, reject redirects, bound response bodies to 4 MiB and time out after 15 seconds. Transient errors retry up to three attempts; rate-limit delays are bounded. Identification is `JobPilot/0.0.0 (+JOBPILOT_REPOSITORY_URL)`; the default public repository is https://github.com/sepiiroth/jobpilot.

Descriptions are converted from HTML to plain text and contact details removed. Unknown country, contract, salary or work mode stays unknown. Full-time alone is not interpreted as a permanent contract. Predicted Adzuna salary is not treated as an actual salary. Records retain source IDs and stable aliases; cross-source title/company/city deduplication uses a 30-day window. Existing ignored matches keep their status.

Offer embeddings are private per user, provider/model profile and content hash, with 1024 dimensions. Canonical normalized offers may be shared, but vectors from different user configurations are never reused. Current-profile counters exclude historical vectors. Failed embeddings preserve collected offers and appear in the report; subsequent collection retries them. Account export includes collection runs, steps, receipts and embedding metadata; account deletion cascades private records. No scheduler or retention purge is added in this phase.

## Verification

```powershell
pnpm --filter @jobpilot/sources test
pnpm --filter @jobpilot/worker test
pnpm --filter @jobpilot/api test
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @jobpilot/web build
pnpm --filter @jobpilot/web verify:client
```

Integration tests use isolated PostgreSQL and Valkey containers and synthetic AI responses. HTTP tests use recorded anonymized API fixtures; provenance is documented beside them in `packages/sources/src/__fixtures__/PROVENANCE.md`. They require no real API credentials or paid AI calls. Tests cover normalization for all four sources, retries and bounds, failed-source isolation, durable recovery, duplicate clicks, ownership, deduplication and embedding isolation.
