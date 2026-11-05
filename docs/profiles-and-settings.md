# Resumes, searches and user settings

Phase 5 adds manual data entry. AI calls, PDF import, embeddings and collection are implemented in later phases.

## Setup

Use the pinned Node.js version from `.nvmrc` and pnpm version from `package.json`:

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm --filter @jobpilot/api start
pnpm --filter @jobpilot/web dev
```

The migration adds embedding-provider, Ollama URL and IMAP preferences to user settings. It does not modify stored resumes or secrets. No additional environment variables are required. Existing `ENCRYPTION_KEY`, previous-key configuration and session settings still apply.

## Resume editor

Open **CV**, create a resume and enter its identity, summary, work, education, skills, languages, projects and professional links. Dates accept YYYY, YYYY-MM or YYYY-MM-DD. Residence is optional; when provided, the country uses a two-letter code. Every field is manually entered; the application never invents experience.

The preview renders the current form. Save before opening the PDF preview or downloading it: both always reflect the saved master resume. The PDF preview opens a separate tab; if pop-ups are blocked, it falls back to a download. The PDF uses selectable text, a single column and standard fonts. No external image or font requests are made. A resume linked to a search or generated document cannot be deleted: first remove its associations. Archiving keeps its contents.

## Searches

Open **Recherches** and associate an active resume. Configure titles, required/excluded keywords, locations and radius, remote preferences, contract types, minimum annual salary in EUR, seniority and sources. Multiline fields use one entry per line. Locations use `city;postal code;country`, with an optional postal code.

Searches may be active or inactive. Sources are stored as preferences; selecting them does not start collection. France Travail remains unavailable.

## Settings and write-only credentials

Open **Paramètres** to select generation/scoring and embedding providers, exact model identifiers, and the Ollama endpoint. The privacy notice explains external processing and local Ollama. Saving preferences makes no external requests.

For IMAP, save the server hostname, TLS port, username, mailbox and authorized sender addresses. Store its password separately under **Clés et mots de passe**. There is no mailbox connection in this phase. The future IMAP connector must enforce TLS, read-only access and hostname/network validation before connecting; a saved hostname is not authorization to bypass those checks.

Credential inputs are masked and initially empty. Saving a replacement encrypts it using AES-256-GCM with a unique IV, authenticated context `userId:kind` and the current key version. Leaving an input empty preserves the existing value. Explicit deletion removes it. Responses expose only the credential kind, `configured` and `lastFour`; no plaintext value or encrypted material is sent to the browser. Full account export omits all credential values as well.

Generation credentials and embedding credentials have separate entries, even for the same provider. Adzuna app ID and app key are both encrypted. Public ATS board identifiers are not credentials: enter a Greenhouse, Lever or Ashby board/company identifier without a full URL.

## HTTP API

All routes below require the existing session. POST and DELETE also require its signed CSRF token. Resource IDs are validated UUIDs. User ownership always comes from the authenticated session.

| Domain        | List / create                    | Read / replace / delete                       |
| ------------- | -------------------------------- | --------------------------------------------- |
| Resumes       | GET / POST `/resumes`            | GET / POST / DELETE `/resumes/:id`            |
| Searches      | GET / POST `/searches`           | GET / POST / DELETE `/searches/:id`           |
| ATS companies | GET / POST `/settings/companies` | GET / POST / DELETE `/settings/companies/:id` |

- `GET /resumes/:id/pdf`: saved master PDF as an attachment, with `Cache-Control: no-store`.
- `GET /settings`, `POST /settings`: provider/model and IMAP preferences.
- `GET /settings/secrets`: credential status only.
- `GET /settings/secrets/:kind`: own credential status, including an unconfigured state.
- `POST /settings/secrets/:kind`: encrypted replacement from `{ "value": <credential> }`.
- `DELETE /settings/secrets/:kind`: delete only the current user's credential.

POST replaces editable fields; it never changes ownership. Foreign resources return 404. Foreign or archived resume associations are rejected. Invalid input returns 400; deletion of an associated resume and duplicate ATS companies return 409.

## Verification

With Docker running:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm audit --prod
pnpm --filter @jobpilot/web build
pnpm --filter @jobpilot/web verify:client
```

Integration tests use temporary PostgreSQL and Valkey containers. They cover CRUD, foreign read/write/delete attempts, cross-user resume associations, write-only encrypted secrets, settings isolation, CSRF and validation. PDF tests extract French text using `unpdf`, check reading order and verify that long resumes retain the final entries over multiple pages.

To visually review a fictional one-page PDF:

```powershell
pnpm --filter @jobpilot/api exec node --import tsx scripts/verify-resume-pdf.mjs <absolute-output-path.pdf>
```

The fixture is explicitly synthetic and contains no real personal data. No Git operation or deployment is required by these checks.
