# Job scoring and offers

The scoring pipeline consumes the BullMQ `scoring` queue after collection and offer embeddings. The collection remains active until scoring finishes, preserving the single-run-per-user rule. The worker uses the user's configured scoring provider/model through the shared LLM module; no additional dependency or provider key is required.

## Three stages

1. The pure hard filter rejects known mismatches in excluded/required keywords, contract, work mode, location and annual EUR salary. Keyword matching ignores case and accents but respects word boundaries and distinguishes C++ from C#. Known country restrictions still apply to fully remote offers.
2. PostgreSQL/pgvector computes cosine similarity between the selected resume and the user's private offer vectors. Provider, model, profile and current content must match; missing or stale vectors do not become zero vectors. Each search has its own results, so the same offer can appear under multiple searches with different analyses.
3. Only the best `SCORING_LLM_TOP_N` candidates per collection and search are eligible for detailed AI analysis. The result is validated as a score from 0 to 100, exactly three strengths, exactly three concerns and a list of missing skills. Points are advisory and based only on supplied evidence.

Unknown contract, location, work mode and salary are retained with explicit reservations, as agreed for phase 8. Radius checks without coordinates are marked unverifiable; no geocoding or approximate distance is invented. Only known annual EUR upper salary bounds below the search threshold are rejected. A lower bound alone does not prove that an offer is underpaid. Foreign currencies are not converted. Fully remote work may bypass the city check, but not a known incompatible country.

Missing embeddings leave visible offers in a waiting state. Missing AI credentials, provider failures or exhausted token budgets preserve the offers with an unavailable analysis and a collection warning. Ranked offers outside the detailed-analysis limit remain visible without a detailed score. `SCORING_LLM_TOP_N=0` disables detailed AI analysis.

## Bounded calls and recovery

`SCORING_LLM_TOP_N` is validated in the worker, defaults to 30 and is bounded from 0 to 100. Each search task persists its budget and attempted offer IDs in PostgreSQL. An advisory lock reserves an attempt before the external call. Failed, timed-out and uncertain calls consume their reservation. Automatic retries are disabled for scoring in both the service and SDK, including after worker restarts. A replay cannot exceed the persisted budget or repeat an uncertain call.

A completed analysis is cached only when the search, resume revision, embedding profile, scoring provider/model/origin and every job field supplied to the scoring prompt still match. Changing the CV, search or provider settings invalidates the visible results. A changed search during an active run is reported as stale and needs a new collection. Lease checks and current-input checks prevent a late result from overwriting newer data.

All offer, resume and search content is enclosed in randomized untrusted-data delimiters. The scoring prompt includes professional resume content, omitting the structured name, email and phone fields. No tools are provided to the model. Calls use the existing monthly token reservation and usage ledger with purpose `job_scoring`.

## Offers and summary

The French Offers page provides filters for search, source, status, minimum detailed score and date first added to matching results. Results are paginated by 20 and sorted by detailed score, then similarity. Date filters refer to the "Ajout" column, not publication date. A source filter includes canonical source aliases after deduplication.

The detail page shows the plain-text description, source link, known facts, reservations and validated AI analysis. Interesting, ignored and restored statuses are shared across all searches for the same offer. Ignored offers are excluded by default and are available only through the explicit ignored-status filter; subsequent collection does not reset their status.

The dashboard summarizes the latest collection: new retained offers, distinct retained offers, analyzed offers and up to five best offers. Duplicate searches do not inflate these summary counts.

## API

All routes require an authenticated session; writes also require CSRF protection. Unknown and foreign IDs return 404.

- `GET /jobs`: optional `searchId`, `source`, `status`, `minScore`, `from`, `to`, `page`. Without status, ignored offers are excluded. Dates are ISO calendar dates; the end date is inclusive.
- `GET /jobs/:id`: one owned search/offer correspondence. IDs identify a search match, not a globally shared offer.
- `POST /jobs/:id/status`: `{ "status": "new" | "interesting" | "ignored" }`. Applied status is read-only in this phase; application tracking remains phase 11.
- `GET /jobs/summary`: latest collection summary and best visible matches.

Account export schema version 3 includes owned search matches and scoring tasks. Account deletion cascades both. Shared normalized offers contain no candidate information.

## Setup and verification

Use Node.js 24.22.1, pnpm 10.34.9 and Docker. Configure `SCORING_LLM_TOP_N` in the worker environment. Apply migrations through the API or locally before starting the updated worker; the worker never migrates the database.

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm audit --prod
pnpm --filter @jobpilot/web build
pnpm --filter @jobpilot/web verify:client
```

Run API, worker and web in separate terminals:

```powershell
pnpm --filter @jobpilot/api start
pnpm --filter @jobpilot/worker start
pnpm --filter @jobpilot/web start
```

Tests use isolated PostgreSQL/Valkey containers, anonymized source fixtures and synthetic AI responses. Coverage thresholds of 80% apply individually to the hard filter, matching repository and scoring worker. Integration tests cover independent search budgets, replay, failed-call limits, ownership, ignored-state preservation, unavailable vectors, changed inputs, lease heartbeats, filters and export. Browser verification is temporary tooling; the phase 12 Playwright suite is not introduced here.
