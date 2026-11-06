# Publication review

This checklist is a release gate, not a declaration that the instance is already production-ready. Automated evidence is recorded below. Two maintainer-only checks remain open. Do not publish private configuration, personal resumes, mailbox contents or backup identities.

## Annex B evidence

- [ ] **Full Git history secret scan:** maintainer-only. The assistant is explicitly prohibited from Git/GitHub operations and cannot certify deleted historical content. Run the installed Gitleaks Git-history scan yourself before publication and resolve every finding, including credential rotation when appropriate.
- [x] **Fixtures and screenshots contain no real personal data:** reviewed the six generated captures; the resume, account and employer are fictional, with reserved example domains. No provider or mailbox credentials are used by the browser fixture.
- [x] **Production dependency and image scans contain no high/critical findings:** `pnpm audit --prod` and OSV passed after adding the approved dependencies (739 production package versions queried). Strict Trivy HIGH/CRITICAL scans of all five final Alpine images passed on 6 November 2026, without suppression or ignore-unfixed.
- [x] **Security versions checked:** PostgreSQL 18.6 and pgvector 0.8.7 were verified in the recovery drill after reviewing upstream advisories. Next 16.4.5 matches the official 3 November security release. Node 24.22.1 remains pinned to the October security release; upstream has announced another security release for 11 November 2026, so recheck before publishing after that date. Exact image scan evidence is recorded separately.
- [x] **Private vulnerability reporting documented:** `SECURITY.md` directs reporters to GitHub private vulnerability reporting. The maintainer must enable that repository feature.
- [x] **Authorized sources only:** README and source guides prohibit scraping that violates terms. France Travail remains disabled until access and its contract are approved.
- [ ] **Independent clean installation:** must be performed by a third party using `docs/deployment-caprover.md`. Automated isolated builds and smoke checks do not replace that person's review. Record the date, tested versions and any documentation corrections.
- [x] **License chosen:** repository `LICENSE` is GNU AGPL v3; retain third-party license notices for dependencies and generated UI components.
- [x] **Synthetic screenshots and demonstration:** the Playwright main-flow test passed on 6 November 2026 with Chromium 158.0.8127.18, desktop and mobile layouts, real auth/queues and simulated provider responses. Screenshots are documented in `user-guide.md`.

## Recovery evidence

The repeatable isolated drill is `pnpm verify:recovery` after building `jobpilot-worker:phase12`. It creates disposable databases and never targets `.env`'s normal database. The drill uses the production image's PostgreSQL/age tools and checks table counts, a structured resume, document version, application, encrypted secret decryption, vector data, session revocation and rejection of a nonempty target. **Verified on 6 November 2026:** the isolated drill restored a Debian PostgreSQL 18 / pgvector 0.8.2 archive into a new Alpine PostgreSQL 18.6 / pgvector 0.8.7 database, using age 1.3.2 and worker UID 1000. It also rejected an incorrect age identity without populating the target and verified cleanup after an upload failure. All temporary containers were removed. Repeat the drill against a real stored archive before a production cutover.

## Sources reviewed on 6 November 2026

- [PostgreSQL 18 security table](https://www.postgresql.org/support/security/18/)
- [PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/release/18.6/)
- [pgvector 0.8.7 security release](https://www.postgresql.org/about/news/pgvector-087-released-3392/)
- [Next.js November security release](https://nextjs.org/blog/november-2026-security-release)
- [Node.js October security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Node.js November security announcement](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases)

The repository's minimum-version table is not sufficient evidence that a version remains patched. Check the relevant upstream advisories and scan the exact built images for every release.

## Security boundary review

| Boundary                    | Evidence                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and CSRF     | Real Argon2 sessions, expiry, login limits, CSRF rejection and logout tests in the API suite; unauthenticated access and logout redirect in Playwright.                                                                                                                                                                                         |
| Ownership and deletion      | API integration tests cover resumes, searches, credentials, offers, generated versions, applications, exports and account cascades. The new schedule is read/saved only for the session owner; stale deliveries recheck current settings inside the collection lock.                                                                            |
| Secrets and logs            | AES-256-GCM ownership-bound encryption, write-only secret routes and redacted request logs remain covered. Backup credentials stay in worker environment variables; PostgreSQL credentials do not appear in argv; provider errors are replaced with generic messages.                                                                           |
| Untrusted inputs            | Zod validates HTTP and model data; source transports enforce host allowlists, TLS, bounds and redirect policy. Email tests enforce sender restrictions, trusted TLS, read-only access and UID reuse. No HTML scraping fallback exists.                                                                                                          |
| AI and documents            | Provider selection, quota/usage reservations, invalid-output and prompt-boundary tests remain enforced. Deterministic integrity tests block unsupported facts; Playwright requires review before PDF export and verifies that generation leaves the master unchanged.                                                                           |
| Browser                     | Nonce CSP and security headers remain in place; no Edge runtime or remote image optimization is used. Production client bundle verification checks for server credential references.                                                                                                                                                            |
| Daily operations            | Numeric UTC cron validation rejects impossible dates; BullMQ delivery, cooldown and duplicate-start tests exercise real queues. Retention locks references and flags before deletion. Backups encrypt before disk/upload, validate checksum and recreate retry streams; restoration refuses a populated database and revokes restored sessions. |
| Supply chain and deployment | Exact npm versions, frozen installs, blocked install scripts, npm audit and OSV checks; non-root images and image scans. Workflow files are authored only; no Git, GitHub API, publication or CapRover operation was executed.                                                                                                                  |

A passing automated scan cannot replace the history scan or the independent installation review. Those remain explicit publication conditions.

## Image security evidence

Debian base scans retained HIGH/CRITICAL findings despite available package updates. With the developer's explicit approval, all three Node build/runtime images now use Alpine 3.24, and the database uses a custom PostgreSQL 18.6 Alpine image with pgvector 0.8.7 built from a SHA-256-verified PGXN archive. The database replaces the official image's outdated Go-based gosu binary with Alpine's maintained su-exec 0.3-r0 package; the entrypoint still drops to the postgres user before starting the server. Build tools are absent from the final database image.

The final strict Trivy 0.65.0 scans returned zero HIGH and zero CRITICAL findings for API, worker, web, PostgreSQL/pgvector and Valkey. No suppression file or ignore-unfixed option is used. Scan the exact images again for each release: this is dated evidence, not a permanent guarantee. The release workflow scans the custom database artifact too, but database deployment remains manual after a verified restore into a new volume. See [deployment instructions](deployment-caprover.md).

Reproduce the scans with the commands in [the phase validation report](phase12-validation.md). Debian-to-Alpine restoration, native Argon2/Prisma and the browser flow are checked separately; a clean image scan alone does not prove application correctness.
