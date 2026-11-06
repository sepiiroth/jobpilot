# Application tracking

Phase 11 adds the private **Candidatures** board: À postuler, Postulé, Entretien, Offre and Refus. Start from an owned offer using **Ajouter au suivi**, or use **Marquer comme postulée** after submitting the application yourself. Nothing is sent to recruiters.

## Creating and moving cards

Tracking and marking an offer as applied are idempotent. The applied action creates the application and updates the offer flag in one transaction. A tracked draft is promoted to Postulé; repeating the action does not reset an interview, an offer or a refusal, and does not overwrite the original application date or notes.

Known duplicate offers for the same user reuse the existing application, following the same exact-URL or recent deduplication identity used by collection. Private email content is never merged into the public catalog. Newly collected copies inherit applied or ignored flags already known to that user.

Use the drag handle to move a card with a mouse or touch. With a keyboard, focus the handle, press Space or Enter, use the arrow keys, then Space or Enter to drop. Escape cancels. A native status selector is also available on every card. Screen-reader instructions, destination announcements and save feedback are in French. Cards are ordered by their creation identifier; this phase does not persist a custom ordering within a column.

The board loads 50 applications per page and can load all older pages. Column counts and the due-only filter apply to the loaded cards. Moving a card is confirmed only after the server saves it; a failure keeps the stored state and displays an error.

## Dates, notes and conflicts

Dates are calendar values (`YYYY-MM-DD`), stored in the existing UTC timestamp columns and returned as calendar dates. Browser actions supply the local calendar date when first marking an application as submitted. Existing dates are retained during later moves. Notes are limited to 10,000 characters.

A non-final card with a follow-up date on or before the current local calendar day displays **À relancer**. The comparison refreshes every minute. Offre and Refus are considered closed for this badge. No email notification or scheduled task is added in this phase.

An integer revision prevents one browser window from silently overwriting another window's notes or status. A stale save returns `APPLICATION_CHANGED`. The editor offers an explicit reload rather than discarding unsaved fields automatically.

Offer interest flags and application history remain distinct: manually ignoring an offer does not delete its application. Editing notes alone preserves that choice. Moving a stage or changing the application date synchronizes the submitted/interesting flag again.

## Documents used

Choose saved resume and cover-letter versions in the detail dialog. Each choice is checked for ownership, document kind, relationship to the application or a known owned duplicate offer, and current integrity approval. A newly attached blocked document returns `DOCUMENT_REVIEW_REQUIRED`.

The association points to a specific immutable content version. Generating or editing a later version does not silently replace it. If the master resume changes later, the association remains as historical tracking, while the phase 10 integrity gate still blocks exporting a version that needs review. A selected version can be inspected without changing it. Blank document fields are allowed for applications sent using documents managed outside JobPilot.

Application cards and their saved offer description remain accessible after the original search is deleted. The internal offer link is shown only while an owned search match exists. Export schema version 5 includes application revisions and links; account deletion cascades applications and their other owned records.

## API and migration

All routes require the existing authenticated session; writes require CSRF protection.

- `GET /applications?cursor=<uuid>`: owned history in pages of 50.
- `GET /applications/:id`: owned card and retained offer context.
- `POST /jobs/:matchId/application`: idempotent tracking from an owned offer.
- `POST /jobs/:matchId/status` with `status: applied`: atomically record submission.
- `POST /applications/:id`: `{ revision, fields }` for dates, notes, status and document IDs.
- `POST /applications/:id/status`: `{ revision, status, appliedAt? }` for card movement.
- `GET /applications/:id/documents?cursor=<uuid>`: owned eligible document history.

Migration `20261106010000_application_tracking` adds the revision column with default 1, including existing rows. Deploy the API migration before the updated web application. The worker never runs migrations.

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

Integration tests use disposable PostgreSQL and Valkey, synthetic offers and simulated AI outputs. They cover repeated submission, tracking promotion, stale updates, preserved notes, duplicate identity, document approval/ownership/kind/offer checks, retained historical versions, pagination, CSRF, export and account deletion. Browser verification covers keyboard drag, pointer drag, selector movement, notes, due badges, document links and responsive layout. Playwright remains in phase 12.

The approved dependencies are `@dnd-kit/react` and `@dnd-kit/dom` at exact version `0.5.3`, compatible with the installed React 19 release. Official references: [React quickstart](https://dndkit.com/react/quickstart/), [sensor configuration](https://dndkit.com/react/guides/sensors/).
