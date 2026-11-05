# API and authentication

Phase 2 provides NestJS HTTP services only. Public registration has no endpoint; create accounts through the CLI. No phase 3 interface is included.

## Local setup

Use Node.js 24.22.1 and the pinned pnpm version. Start Compose, set DATABASE_URL and VALKEY_URL in the ignored .env file, then generate ENCRYPTION_KEY and SESSION_SECRET independently with node:crypto randomBytes(32).toString('base64'). Never copy keys into tracked files. Run pnpm db:generate and pnpm db:migrate before starting the API.

- Start: pnpm --filter @jobpilot/api start
- Watch: pnpm --filter @jobpilot/api dev
- Health: GET http://localhost:3001/health (checks PostgreSQL and Valkey)
- Development OpenAPI: http://localhost:3001/docs and /docs-json

API_HOST defaults to 127.0.0.1. Use 0.0.0.0 inside a future container. API_PORT defaults to 3001. TRUST_PROXY_HOPS defaults to 0; set it to the actual trusted reverse proxy count before deployment, and prevent direct access to the backend. Production WEB_ORIGIN must use HTTPS. Cookies always use Secure, HttpOnly, SameSite=Lax and Path=/; use HTTPS outside localhost.

## Account commands

Provide CLI_USER_EMAIL and CLI_USER_PASSWORD temporarily in the process environment, then run one of:

```powershell
pnpm --filter @jobpilot/api cli user:create
pnpm --filter @jobpilot/api cli user:reset-password
```

The password must contain at least 12 characters and at most 1024. Do not put passwords in command arguments or commit them in examples. Remove both CLI variables after use. Resetting a password revokes all sessions. Commands print only success or a generic error, never account credentials.

## Browser protocol

1. GET /auth/csrf with credentials included. Keep the returned csrfToken and accept the HttpOnly CSRF cookie.
2. POST /auth/login with JSON email and password, credentials included and X-CSRF-Token set to that token.
3. Keep the replacement csrfToken returned by login. It is cryptographically bound to the new session.
4. Send credentials on every request and the current X-CSRF-Token on every state-changing request. GET /auth/csrf refreshes the CSRF token after a page reload.

WEB_ORIGIN must exactly match the browser origin, without a trailing slash. Foreign Origin headers are rejected for writes. CORS allows credentials for that exact origin only. Cross-origin clients read the CSRF value from JSON rather than the cookie. All authentication and account responses disable caching.

| Method | Route            | Payload / behavior                                  |
| ------ | ---------------- | --------------------------------------------------- |
| GET    | /auth/csrf       | Public; returns signed CSRF token                   |
| POST   | /auth/login      | email, password; starts session                     |
| GET    | /auth/me         | Current account without password hash               |
| POST   | /auth/logout     | Revoke current session                              |
| POST   | /auth/logout-all | Revoke all account sessions                         |
| POST   | /auth/password   | currentPassword, newPassword; revokes all sessions  |
| GET    | /users/me/export | Download current account data as JSON               |
| DELETE | /users/me        | password; permanently delete account and owned rows |
| GET    | /health          | Database and Valkey readiness                       |

Sessions slide for seven days and expire absolutely after 30 days. Only SHA-256 session hashes are stored. Login uses Argon2id with 19 MiB, two iterations and one lane; missing accounts still run a dummy password verification. Valkey atomically enforces five login attempts per 15 minutes per IP/email pair, an additional 100 per IP per 15 minutes, and 100 requests per minute per session. Nest also applies a 100-per-minute IP ceiling. Only configure proxy trust for infrastructure you control.

Errors have the shape { error: { code, message } }. Internal exceptions and validation payloads are hidden. JSON requests are limited to 1 MiB. Log serializers omit bodies, query parameters, cookies, authorization and exception messages/stacks; credential fields are also redacted.

## Encryption rotation

CryptoService uses AES-256-GCM, a random 12-byte IV, authenticated context and a keyVersion. Callers must use a stable context including the owner and secret kind. Set ENCRYPTION_KEY_VERSION to the current positive version and ENCRYPTION_KEY to the corresponding 32-byte base64 key. ENCRYPTION_PREVIOUS_KEYS is a JSON map from older version numbers to base64 keys. Never reuse a version for a different key.

Retain previous keys while decrypting old rows and re-encrypting them with rotate(). Remove an old key only after every row referencing it has been migrated and backups remain recoverable. The service supports rotation; no automatic production rotation job is run in this phase.

## Export and deletion

Exports use a consistent transaction and filter each owned table by the authenticated account. Public offers are included only when linked through that account's matches, documents or applications. Password hashes, session token hashes and encrypted secret material are deliberately omitted; secret configuration metadata is included. Derived embeddings are not exported. Account deletion verifies the password and cascades to owned rows; shared public offers remain.

## Verification

Run pnpm lint, pnpm typecheck, pnpm test, pnpm format:check and pnpm audit --prod. Tests require Docker and run against disposable PostgreSQL and Valkey containers; they do not use the local account database. API tests enforce 80% coverage thresholds for authentication and encryption. The ownership assertion in src/testing/idor.ts is reusable by future CRUD suites.
