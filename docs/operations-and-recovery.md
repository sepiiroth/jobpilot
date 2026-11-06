# Daily operations and encrypted recovery

Collection scheduling is disabled by default. In **Paramètres → Collecte planifiée**, leave the cron field empty to disable it, or enter a numeric five-field cron expression. All times use UTC; `0 7 * * 1-5` runs at 07:00 UTC on weekdays (08:00 in Paris in winter, 09:00 in summer). Supported syntax: numbers, `*`, comma lists, ranges and steps. Seconds, names and macros are rejected. Changes converge within one minute. Missed slots are not replayed after downtime.

BullMQ Job Schedulers produce work in the internal `operations` queue. Each job rechecks the user's current saved schedule inside the same database lock used by manual collection. Deleted accounts, disabled schedules and obsolete jobs cannot start a new collection. Active runs and collection cooldowns remain enforced. Only active searches with a non-archived resume are collected. The collection worker recovers committed queued runs; Valkey is not the sole record of work.

## Retention

At 02:00 UTC, old offers are considered for deletion based on `fetchedAt` and `JOB_RETENTION_DAYS` (default 60). Any user's explicit interesting, ignored or applied action preserves the offer, as do an application, a generated document or a queued/running collection reference. Ignored flags are retained to prevent reappearance. A recent fetch refreshes retention. Each nightly job drains up to 100 batches of 500 candidates to bound maintenance time; any remaining candidates are reconsidered the next night. Database locks and a second predicate check protect concurrent references and flag changes. Dependent aliases, embeddings and untouched matches cascade with the deleted offer.

## Backups

Use an existing S3-compatible bucket dedicated to this instance. Grant its credentials only the necessary object write permissions on the `jobpilot/` prefix. Configure a bucket lifecycle/retention policy suitable for personal data, including noncurrent versions. Account deletion removes live data; encrypted historical backups remain until that lifecycle expires. A restore must reconcile deletions made after the snapshot before reopening access.

Generate an age X25519 identity on an administrator-controlled machine:

```sh
age-keygen -o jobpilot-backup-identity.txt
age-keygen -y jobpilot-backup-identity.txt
```

Keep the identity offline in a password manager or encrypted administrator storage. Only the public `age1…` recipient belongs on the worker. Keep `ENCRYPTION_KEY` and all previous key versions separately: the database's encrypted API credentials cannot be recovered without them. Do not put either identity or encryption keys inside the backup bucket or repository.

Configure the worker's `BACKUP_S3_ENDPOINT` (HTTPS), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_S3_REGION` (default `us-east-1`) and `BACKUP_AGE_RECIPIENT`. Empty configuration disables backups; partial/invalid configuration prevents worker startup. No database credentials or S3 credentials are returned to the browser.

A nightly job at 03:00 UTC streams `pg_dump --format=custom --no-owner --no-acl` directly into age. Only ciphertext reaches a private temporary directory. It uploads a unique dated `.dump.age` object, then removes the local ciphertext even on failure. PostgreSQL credentials use subprocess environment variables, never command-line arguments. Subprocess stderr is suppressed to prevent secret leakage. Uploads are bounded and retried; archives above 5 GB fail explicitly (this POC uses a single object upload). Failed jobs retain a generic error. The settings page shows disabled/pending/succeeded/failed and the last successful upload time; unavailable worker status is reported separately. This confirms upload, not recoverability: perform regular restore drills.

## Restore procedure

1. Stop API and worker access. Download the chosen encrypted archive using the storage provider's trusted client. Check the object version/date and checksum. Never restore an untrusted PostgreSQL dump.
2. Start an isolated PostgreSQL 18.6+ server with pgvector 0.8.7 installed. Create an **empty database on a new target volume** owned by the restore role. When changing OS/libc/ICU variants, rebuild through restore and verify collation-sensitive indexes/queries before cutover; PostgreSQL documents why a version mismatch can invalidate stored sort order. Do not run migrations first: the archive contains the schema, migration history, extension, rows and vectors. Never point the restore command at production's existing database.
3. Mount the encrypted archive and age identity read-only into the worker image, or install PostgreSQL 18 client tools and age locally. Supply these temporary environment variables through your secret manager/shell, without committing them:
   - `RESTORE_DATABASE_URL`: new empty target connection URL
   - `RESTORE_AGE_IDENTITY_FILE`: mounted private age identity path
   - `RESTORE_ARCHIVE_FILE`: downloaded ciphertext path
   - `RESTORE_CONFIRM_EMPTY_DATABASE=true`
4. Run from the worker package directory:

   ```sh
   node --import tsx src/operations/restore-cli.ts
   ```

   The command refuses any existing user relation. Decryption streams into `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`; plaintext is never written to disk. All restored sessions are revoked before success is reported.

5. Verify row counts, a representative structured CV, application and document history, decrypted saved credentials and a vector similarity query. Reconcile any account deletions since the snapshot. Apply only **newer** migrations if needed, restore the separately held encryption key versions, then start API and worker. Re-enter credentials if keys were intentionally rotated/lost. Scheduling will reconcile from saved user settings. Log in anew and perform a manual collection before reopening access.
6. Remove the temporary identity mount and clear restore variables. Keep a dated drill record including archive version, tool/server versions and checks. Do not publish private archive contents or credentials.

## France Travail

`FranceTravailSource` provides a normalized contract boundary but is deliberately disabled: `isConfigured()` is false and `fetch()` fails before HTTP. It is excluded from selectable sources and the collection registry. Enabling it requires approved API access, the current official authentication/rate-limit contract, fixtures and SSRF allowlist review; no scraping fallback is available.

## References

- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers/)
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)
- [PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)
- [age format and command documentation](https://age-encryption.org/)

## Repeatable recovery drill

Build the worker image, then run the isolated drill from the repository root:

```sh
docker build -f apps/worker/Dockerfile -t jobpilot-worker:phase12 .
pnpm verify:recovery
```

The drill never reads the normal database URL from .env. It generates temporary credentials, runs migrations on a disposable Debian PostgreSQL 18 source with pgvector 0.8.2, creates synthetic data, encrypts a snapshot, restores it into an empty custom Alpine PostgreSQL 18.6 target and verifies pgvector 0.8.7 and checks every application table count, vector dimensions, saved credential decryption, CV/document/application content and revoked sessions. It also checks a wrong identity, a nonempty target and upload-failure cleanup. PostgreSQL and the test network are removed in a finally block. The Alpine production image supplies pg_dump/pg_restore/psql 18.6 and age 1.3.2. This drill passed on 6 November 2026; S3 upload behavior is checked with a simulated SDK transport, including checksums, fresh streams on retry and credential rejection. No real cloud credentials are used by these tests.
