# Tailored resumes and cover letters

Phase 10 adds private, versioned drafts from an owned offer. It does not send applications, contact recruiters or modify master resumes.

## Use

Open an offer and choose an active master resume, tone (formal, neutral, direct), length (short, medium, long) and French or English. **Générer CV et lettre** makes two separate measured model calls, using the generation model configured in Settings. If the second call fails, the first draft remains available. The offer and master resume are sent to that provider; Ollama can keep processing local.

Select a history entry to view, edit or export it. Saving edits creates another immutable content version; earlier versions remain accessible through cursor pagination (50 entries per page). Manual edits have zero model consumption and retain their own review state. The master editor and generated editor share form fields, but save through separate endpoints.

## Integrity and review

The prompt treats the master resume and offer as untrusted data behind randomized delimiters. The master is the only authority for candidate facts. The model has no tools. Its response is validated with Zod.

The deterministic checker compares identity fields, employers, job titles and dates, education institutions/degrees/areas/dates/courses, skills/levels/keywords, languages and projects. Facts stay attached to their original entry: moving a valid date or skill into a different experience does not silently pass. Existing entries and bullets may be reordered or omitted. Exact spelling is intentionally conservative; translating a factual field may require review.

Free prose cannot be proven equivalent by string comparison. Every changed summary, description or bullet is therefore flagged for review, even if it is only a harmless paraphrase. The full cover letter always requires review, including claims concealed inside ordinary sentences. This is a review barrier, not an automated factual certification or a semantic hallucination detector.

The UI shows flagged content in red and offers the current master for comparison. Correct invented claims by saving a new version. Explicitly check every remaining issue and confirm that the document was compared against the master before validation. PDF and copy-text endpoints reject blocked documents with `INTEGRITY_REVIEW_REQUIRED`; browser controls alone are never the enforcement boundary.

Approval is bound to both the content fingerprint and the current parsed master fingerprint. Editing the draft creates a version without approval. Changing the master invalidates prior approval and blocks export again, even if the draft otherwise has no new flagged facts. A master edited during generation is also detected. Each review checks the current issue set server-side and locks the master while recording the decision.

## Usage and costs

Every generated version records its successful call's usage ID, provider, model, input/output tokens and estimated USD cost. Pricing comes from the existing `LLM_PRICING_JSON` map. Missing pricing is shown as unavailable, never as a zero-cost call. If earlier attempts have uncertain usage, the UI reports them separately; the displayed successful-call amount does not claim to include unknown charges. The global usage screen remains the ledger for failed calls and monthly limits.

Manual edits record zero tokens and zero cost, without copying a previous version's charges. Historic model-call entries remain visible. Existing timeouts, bounded retries and monthly token reservations apply. No external provider is called in tests.

## API

All routes require the existing session. POST routes also require CSRF protection.

- `GET /jobs/:matchId/documents?cursor=<uuid>`: owned history, newest first.
- `POST /jobs/:matchId/documents`: `{ resumeId, kind, params: { tone, length, language } }`.
- `GET /documents/:id`: content, parameters, current integrity report and costs.
- `POST /documents/:id/versions`: `{ content }`, with a matching document kind.
- `POST /documents/:id/review`: `{ sourceFingerprint, issueIds }`, covering every current issue.
- `GET /documents/:id/pdf`: reviewed saved version, selectable-text PDF.
- `GET /documents/:id/text`: reviewed letter text for explicit user copying.

The job identifier is the owned search-match identifier used by the offer detail page. Guessing a public offer ID does not authorize generation. Resume ownership and archived state are checked before any model call. Documents are stored in the existing `generated_documents` table; no schema migration is needed. Account export and deletion already include them.

## Verification

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

Integration tests use disposable PostgreSQL/Valkey and synthetic model responses. They cover invented employers, unchanged masters, measured costs, invalid model output, concurrent version allocation, stale master fingerprints, review invalidation, PDF text extraction, CSRF and ownership for all document routes. Integrity coverage is enforced at 80% for statements, branches, functions and lines. Browser checks use the same simulated-provider boundary; Playwright remains in phase 12.
