# Read-only email alerts

Phase 9 adds the `email` source to manual collection. It reads the user's own job-alert mailbox over verified TLS, extracts job vacancies through the configured small/scoring model and passes private normalized offers to the existing embedding and scoring pipeline. It does not scrape job sites or follow offer URLs.

## Setup

1. Use a dedicated mailbox or folder for job alerts. In Settings, enable IMAP and enter the server hostname, TLS port (usually 993), username and mailbox name.
2. Enter exact authorized sender addresses. Addresses are compared case-insensitively; multiple From addresses are rejected. An empty effective allowlist prevents any connection.
3. Save the mailbox password under **Mot de passe IMAP** in the separate credential form. App passwords may be required by the mailbox provider. The password uses the existing AES-256-GCM encryption and key rotation, scoped to `userId:imap`. Responses expose only configuration status and the last four characters.
4. Configure a working scoring/text model and an embedding provider. Select **Alertes e-mail** in the relevant active searches, then start collection from the dashboard.

The settings screen saves configuration without connecting. Collection is the action that reads the mailbox and sends the cleaned useful message content to the user's selected provider. A local Ollama endpoint allows local AI processing. No real mailbox is contacted by automated tests.

`EMAIL_ALERT_ALLOWED_SENDERS` is an optional administrator restriction. If the user's list and administrator list are both nonempty, their intersection applies. If only one list is nonempty, that list applies. The sender allowlist filters exact From addresses; it is not SPF/DKIM authentication. Keep the mailbox provider's authentication and anti-spoof filtering enabled.

## Read-only behavior and UID tracking

The connector requires immediate TLS and opens the mailbox with `EXAMINE` (`readOnly: true`). Downloads use read-only fetches. It never changes `\\Seen`, stores flags, moves messages, expunges or deletes mail. Tests compare mailbox flags before and after actual downloads.

Processing state is stored only in JobPilot, using `(userId, account fingerprint, UIDVALIDITY, UID)`. The account fingerprint includes hostname, port, username and mailbox; the special INBOX name is normalized case-insensitively. Password changes do not reset the cursor. Unsigned 32-bit UIDs are stored as decimal strings without signed-integer truncation. A changed UIDVALIDITY creates a separate namespace, so reused UID numbers cannot collide.

A receipt is reserved atomically before the AI call. A completed, failed or uncertain receipt is never automatically extracted again, including after restart or concurrent collection. Scoring-mode extraction disables provider retries; an uncertain or failed call is reported and consumes that receipt. A transport failure before reservation may be read again, but cannot duplicate a reserved AI extraction. Completed offers survive transport failures and remain available from the private cache.

Each collection scans a bounded UID window from the cursor. The default window is at most 20 UID positions; expunged gaps can result in fewer messages. Later collections advance through the backlog. Completed cached alerts are reused for other selected searches without another AI call.

## Limits and reports

| Worker setting                | Default | Meaning                                                                |
| ----------------------------- | ------- | ---------------------------------------------------------------------- |
| `EMAIL_ALERT_MAX_MESSAGES`    | 20      | Maximum UID positions scanned per collection; 1–100                    |
| `EMAIL_ALERT_MAX_BYTES`       | 512000  | Maximum raw MIME message size; 1024–2000000                            |
| `EMAIL_ALERT_CACHE_MESSAGES`  | 100     | Maximum recent receipts considered for cached offers; 1–1000           |
| `EMAIL_ALERT_TIMEOUT_MS`      | 15000   | DNS/connection and individual IMAP operation time budget; 1000–60000   |
| `ALLOW_PRIVATE_IMAP_HOST`     | false   | Explicit administrator permission for supported private/loopback hosts |
| `EMAIL_ALERT_ALLOWED_SENDERS` | empty   | Optional comma-separated administrator sender restriction/default      |

The shared `source-email` BullMQ permit queue limits IMAP operations to one per second across workers sharing the prefix. Existing collection time and offer-count limits still apply. Individual IMAP commands retain their hard timeout while the socket idle allowance accommodates AI calls between commands. Oversized messages are ignored without extraction. Missing messages, sender mismatches and unauthorized envelopes do not reach the model. Missing provider credentials, invalid model output, invented URLs, timeouts and uncertain receipts are reported safely while other sources continue.

Cache truncation and unprocessed backlog appear as collection warnings. Older stored matches remain available; changing the cache bound does not delete them. There is no automatic scheduling, message purge or retention job in phase 9.

## Network and content handling

The worker validates all resolved IPv4/IPv6 addresses and pins a permitted numeric address for the connection. TLS still validates the original hostname. Private networks are denied by default; enabling private hosts does not disable certificate verification. Link-local/cloud metadata, multicast, unspecified and unsupported special ranges remain blocked. For an internal CA, add its public certificate to Node's trusted roots through the deployment environment; never disable TLS verification.

The MIME parser receives bounded input, never writes attachments and does not execute HTML. Script, style and image tracking URLs are excluded from grounded links. Contact patterns and raw tracking URLs are removed from model text. Structured extraction is validated by Zod; each returned URL must match a cleaned link actually present in the message. Known tracking parameters are removed, and encoded redirect targets are decoded without network requests. Descriptions are stored as plain text.

The versioned extraction prompt encloses all message text and links in randomized untrusted-data delimiters and provides no tools. Required title/company facts must be explicitly stated. Other unknown facts stay unknown. The usage purpose is `email_extraction`, and existing monthly token limits and cost reporting apply.

## Privacy, deduplication and export

Email-derived offers belong to their user through `privateUserId`. They never merge private email descriptions or URLs into the shared public offer catalog. Email deduplication operates within the owner's private catalog. Status changes and ignored-state inheritance remain scoped to the same user and recognized duplicate identities, so a private copy does not resurrect a previously ignored known offer.

Only normalized offers, hashed account/sender identifiers, UID metadata and safe error codes are retained. Full raw messages, attachment data and passwords are not stored in receipts or queue payloads. Queue jobs still contain only owned record IDs. Export schema version 4 includes owned email mailbox cursors and receipt data. Account deletion cascades private offers and email state. No other user's cached messages or vectors are reused.

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

The worker integration suite creates disposable Dovecot `2.4.5-dev`, Mailpit `v1.27.10`, PostgreSQL and Valkey containers. Dovecot complements Mailpit because Mailpit provides SMTP/POP3 rather than IMAP. The same synthetic RFC 822 fixture is submitted through SMTP to Mailpit and saved to Dovecot for IMAP tests. Test certificates, keys and passwords are generated at runtime; TLS verification remains enabled. The additional test CA is scoped to the test worker and restored afterward.

Tests verify certificate trust, hostname checks, EXAMINE/read-only behavior, unchanged flags, MIME parsing, sender rejection before download, one extraction per UID, private caching, failure/restart behavior, two searches through BullMQ, encryption, account ownership and deletion. They use synthetic AI responses and reserved example domains, never external mailbox credentials or paid AI calls. The Playwright suite remains phase 12.

## References

- [ImapFlow client API](https://imapflow.com/docs/api/imapflow-client/)
- [MailParser options](https://nodemailer.com/extras/mailparser)
- [Dovecot Docker deployment](https://doc.dovecot.org/2.4.3/installation/docker.html)
- [Mailpit protocols and configuration](https://mailpit.axllent.org/docs/configuration/)
