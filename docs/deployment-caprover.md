# Deploy JobPilot on CapRover

This guide covers the containerized web, authenticated API and standalone worker. Phases 5–8 add profiles, AI, collection and scoring; scheduling and backups remain later phases. The assistant prepares these files and verifies local images; only the maintainer publishes releases and starts deployments.

## 1. Prerequisites

Prepare a Linux VPS with Docker and CapRover installed, a DNS zone, a CapRover administrator account and a repository owned by your GitHub account or organization. The supplied images target linux/amd64 by default; use an amd64 server or adjust the build platform after verifying the corresponding native dependencies.

The examples use public documentation domains: jobpilot.example.com for the web, api.jobpilot.example.com for the API, and captain.example.com for CapRover. Replace these names with your own domains. Configure DNS records for those names to point at your server. Follow the official [CapRover setup guide](https://caprover.com/docs/get-started.html) before proceeding. Permit HTTPS to CapRover and the public apps, and protect access to the administration dashboard.

The workflow uses the fixed application names below. Keep those names unless you also change deploy.yml and the connection strings.

## 2. Create the five CapRover apps

| App             | Exposure                                       | Container port | Persistent directory |
| --------------- | ---------------------------------------------- | -------------- | -------------------- |
| jobpilot-db     | Do not expose as web app; no host port mapping | 5432 internal  | /var/lib/postgresql  |
| jobpilot-valkey | Do not expose as web app; no host port mapping | 6379 internal  | /data                |
| jobpilot-api    | api.jobpilot.example.com; force HTTPS          | 3001           | none                 |
| jobpilot-worker | Do not expose as web app; no host port mapping | none published | none                 |
| jobpilot-web    | jobpilot.example.com; force HTTPS              | 3000           | none                 |

Create each app in the CapRover dashboard. For database, Valkey and worker, select **Do not expose as web app**. Do not add host port mappings to those services. Keep PostgreSQL and Valkey at one instance. For the three Node apps, retain a single instance during the POC. On API and web, set the container HTTP port in HTTP Settings and add the corresponding custom domain.

Enable **Has Persistent Data** on the two data apps and mount the directories in the table. For PostgreSQL 18, persist /var/lib/postgresql: the image stores this cluster under /var/lib/postgresql/18/docker. The older /var/lib/postgresql/data path alone does not preserve this layout. This matches the local Compose configuration.

## 3. Start PostgreSQL with pgvector

In jobpilot-db, set POSTGRES_USER=jobpilot and POSTGRES_DB=jobpilot. Generate a unique POSTGRES_PASSWORD locally and save it in the dashboard environment variables. Never place real credentials in captain-definition, workflow files or documentation.

Deploy the existing Docker image pgvector/pgvector:0.8.2-pg18 from the Deployment tab. This image was verified locally to contain PostgreSQL 18.4 and pgvector 0.8.2. Do not use CapRover's standard PostgreSQL one-click image because it does not include pgvector. Wait for the database logs to report readiness.

Other apps reach this database at srv-captain--jobpilot-db:5432 over CapRover's internal network. Build DATABASE_URL from the database name and user above, your password and that host. Percent-encode reserved characters in URI credentials; hexadecimal passwords avoid this encoding issue.

## 4. Start authenticated Valkey

Generate a different unique VALKEY_PASSWORD. Set it in the jobpilot-valkey environment variables. Deploy this inline captain-definition from its Deployment tab so the password is read at container startup rather than stored in an image layer:

```json
{
  "schemaVersion": 2,
  "dockerfileLines": [
    "FROM valkey/valkey:8-alpine",
    "CMD [\"sh\",\"-c\",\"exec valkey-server --appendonly yes --requirepass \\\"$VALKEY_PASSWORD\\\"\"]"
  ]
}
```

Keep /data persistent. The app must have no public domain and no host port mapping. Other apps connect to srv-captain--jobpilot-valkey:6379. Construct VALKEY_URL with the redis protocol, the password as URI credentials and that internal host. Valkey is mandatory even before jobs exist because authentication rate limits use it.

## 5. Configure runtime variables

Generate ENCRYPTION_KEY and SESSION_SECRET independently as 32 random bytes in base64. For example, run a local Node expression using randomBytes(32).toString('base64') from node:crypto. Store the encryption key securely outside the VPS as well; losing it makes encrypted user secrets unrecoverable. Keep the same ENCRYPTION_KEY and key version in API and worker.

### jobpilot-api

| Variable             | Value                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| NODE_ENV             | production                                                                                                       |
| APP_NAME             | JobPilot, or your chosen public name                                                                             |
| API_HOST             | 0.0.0.0                                                                                                          |
| API_PORT             | 3001                                                                                                             |
| DATABASE_URL         | Your internal PostgreSQL URI                                                                                     |
| VALKEY_URL           | Your internal authenticated Valkey URI                                                                           |
| ENCRYPTION_KEY       | Your 32-byte base64 encryption key                                                                               |
| SESSION_SECRET       | Your independent 32-byte base64 session secret                                                                   |
| WEB_ORIGIN           | Exact HTTPS web origin, with no trailing slash                                                                   |
| COOKIE_DOMAIN        | Leave empty for an API host-only cookie; set a common parent domain only if deliberately needed                  |
| TRUST_PROXY_HOPS     | Number of trusted reverse proxies between the client and API; use 1 only for a single trusted CapRover proxy hop |
| REGISTRATION_ENABLED | false; the POC creates accounts through the CLI                                                                  |
| LOG_LEVEL            | info                                                                                                             |

Do not expose the API container directly when enabling proxy trust. See api-authentication.md for encryption key versions and rotation. The API validates required configuration before applying migrations. Every API start runs prisma migrate deploy; it fails without starting the HTTP server when migrations fail. Prisma coordinates concurrent migrations with its database lock.

### jobpilot-worker

Set NODE_ENV=production, DATABASE_URL, VALKEY_URL, ENCRYPTION_KEY and WORKER_HEALTH_PORT=3002. Future rotation variables must remain consistent with the API when encrypted data is introduced. The readiness listener binds only to 127.0.0.1 inside this container. Never expose or publish its port. No queue, scheduled task or migration runs in this phase.

### jobpilot-web

Set NODE_ENV=production, PORT=3000, HOSTNAME=0.0.0.0 and your public APP_NAME if customized. NEXT_PUBLIC_API_URL must also be configured as a build argument through the repository variable described below. Next.js embeds this public URL at build time: changing the runtime value alone does not change the browser's target API or the built CSP. Rebuild and release when it changes.

The web app does not need DATABASE_URL, VALKEY_URL, ENCRYPTION_KEY or SESSION_SECRET. The standalone output includes only web runtime dependencies and static assets. The Docker context excludes .env files and local generated output.

## 6. Domains and HTTPS

After images are available, add your actual domains to API and web. In each app's HTTP Settings, enable HTTPS and force HTTPS. Ensure CapRover's Nginx configuration emits HSTS for your HTTPS apps, as required by your deployment policy. Do not enable HSTS on a domain before HTTPS is working. In HTTP Settings → Edit Default Nginx Configurations, add the following directive inside the HTTPS server block (the block listening on 443), then save and verify the response header:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

Keep it out of the plain HTTP block and do not add includeSubDomains unless every affected subdomain already supports HTTPS.

WEB_ORIGIN must exactly match the HTTPS origin used in the browser. API and web subdomains share a site, so the API's Secure, HttpOnly, SameSite=Lax session cookies work with credentialed browser requests. The web client checks its session through the API and supports host-only API cookies; no cookie needs to be made readable to JavaScript. The API also verifies signed CSRF tokens for state-changing requests.

## 7. Configure GitHub variables, secrets and the registry

The maintainer performs these dashboard actions. The assistant does not create or alter remote settings.

In repository Settings → Secrets and variables → Actions, create repository variables:

| Variable            | Value                                           |
| ------------------- | ----------------------------------------------- |
| NEXT_PUBLIC_API_URL | Exact HTTPS API origin without a trailing slash |
| APP_NAME            | Optional public app name, default JobPilot      |

The build job needs the public variables at repository scope. Do not store server credentials in variables or Docker build arguments.

Create a GitHub environment named production. Configure optional required reviewers there if you want a final approval gate for actual releases. Add these secrets to that environment (repository secrets also work):

| Secret                | Value / source                                  |
| --------------------- | ----------------------------------------------- |
| CAPROVER_SERVER       | HTTPS URL of your CapRover dashboard            |
| CAPROVER_API_TOKEN    | jobpilot-api → Deployment → Enable App Token    |
| CAPROVER_WORKER_TOKEN | jobpilot-worker → Deployment → Enable App Token |
| CAPROVER_WEB_TOKEN    | jobpilot-web → Deployment → Enable App Token    |

The automatically supplied GITHUB_TOKEN pushes images to GHCR. The workflow grants packages:write only to the build job. If organization policy restricts package creation or repository linking, authorize this repository before releasing. For public packages, make each image package public after first publication. For private packages, add ghcr.io credentials in CapRover using a token limited to read:packages; runner login alone does not give CapRover access.

All third-party workflow actions are pinned to full commit identifiers. Update pins only after review. ci.yml is reused by deploy.yml; both regular changes and tagged releases run lint, typing, tests, production dependency audit and gitleaks. Tests use disposable Docker databases and do not connect to the VPS.

## 8. Release pipeline

Only the maintainer creates and pushes a semantic version tag such as v0.1.0, after versioning and reviewing the phase. That tag triggers deploy.yml. The assistant never runs the workflow or pushes a release.

The jobs run in this order:

1. CI validates the repository.
2. A matrix builds web, API and worker locally on runners. Trivy rejects critical vulnerabilities before any image is pushed.
3. Images are published as ghcr.io/<lowercase-owner>/jobpilot-<app>:<version>-<12-character-commit-id>.
4. Deployment actions submit the API, then worker, then web images to CapRover. A failed earlier step stops subsequent steps.

The CapRover action submits deployments in detached mode. A successful action means the request was accepted, not that the new containers are healthy. Check the three apps' logs and Docker health states after every release; do not regard a green submission alone as successful service verification. Release submissions are serialized so separate tag workflows cannot interleave.

The API needs no manual migration step. For the first release, wait for database migrations to complete before creating the first account. Deploy the API first and wait for its migration/startup to succeed before starting the worker. The scoring worker requires the new scoring tables at startup. The local smoke stack enforces this order through the API health dependency.

## 9. First account and runtime checks

On the VPS, locate the running API container with docker ps using the CapRover app name. Start a temporary shell in that exact container as its default node user. Set CLI_USER_EMAIL and CLI_USER_PASSWORD temporarily in that shell, then run node --import tsx src/cli.ts user:create. Enter a password of at least 12 characters; do not paste real passwords into shared logs, workflow arguments or documentation. Unset both variables immediately afterward. The reset command is user:reset-password and revokes all sessions.

For an interactive shell, run the following on the VPS, replacing only the container identifier. The password is read without echo and is never a command argument:

```bash
docker exec -it <api-container-id> bash
unset HISTFILE
read -r -p "Email: " CLI_USER_EMAIL
read -r -s -p "Password: " CLI_USER_PASSWORD
printf '\n'
export CLI_USER_EMAIL CLI_USER_PASSWORD
node --import tsx src/cli.ts user:create
unset CLI_USER_EMAIL CLI_USER_PASSWORD
exit
```

See api-authentication.md for the account command semantics.

Verify:

- https://api.<your-web-domain>/health returns HTTP 200 and both database and Valkey are up.
- The web /connexion page loads with assets and without browser CSP errors.
- Login succeeds, the session cookie is Secure and HttpOnly, and a signed-out visit to /dashboard redirects to /connexion.
- Logging out revokes the session.
- The worker's internal Docker health check is healthy; it has no public listener.
- docker exec <container-id> id -u returns 1000 for every Node app.

API documentation is disabled in production. Expected application ports are 3000 for web and 3001 for API. The worker's 3002 is loopback-only and is never published.

## 10. Local image verification

From the repository root, with Docker running and the ignored .env configured:

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
docker build -f apps/api/Dockerfile -t jobpilot-api:phase4 .
docker build -f apps/worker/Dockerfile -t jobpilot-worker:phase4 .
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 -t jobpilot-web:phase4 .
docker compose -p jobpilot-phase4-check -f docker-compose.smoke.yml up -d --wait --wait-timeout 180
docker compose -p jobpilot-phase4-check -f docker-compose.smoke.yml ps
docker compose -p jobpilot-phase4-check -f docker-compose.smoke.yml exec -T api id -u
docker compose -p jobpilot-phase4-check -f docker-compose.smoke.yml exec -T worker id -u
docker compose -p jobpilot-phase4-check -f docker-compose.smoke.yml exec -T web id -u
docker compose -p jobpilot-phase4-check -f docker-compose.smoke.yml down --volumes
```

This smoke stack creates a separate database and Valkey without published ports or persistent volumes; the down --volumes command removes only its temporary test data, including anonymous database volumes. It does not use the regular local Compose database. Use hexadecimal local POSTGRES_PASSWORD and VALKEY_PASSWORD values so the smoke connection strings are valid without additional URL encoding. ENCRYPTION_KEY and SESSION_SECRET are required as in the API setup. No CapRover or GHCR credentials are needed for these checks.

## 11. Manual recovery and rollback

Each apps/<app>/captain-definition declares an existing-image deployment with explicit replacement markers. Replace both the owner and version/commit markers with the exact published image reference, then submit that file from the app's Deployment tab. Never upload the unedited markers. Use the same release for all three apps. Manual deployment does not build source on the VPS.

Before production releases that change the schema, arrange an external database backup. Automated encrypted backups are a phase 12 feature and are not provided here. A container rollback does not reverse database migrations; only use an older image when it is compatible with the current schema. Restore from your external backup if an incompatible migration requires recovery. Do not delete persistent volumes during rollback.

For build failures, read the failing CI step before retrying. For pull failures, check GHCR package visibility and CapRover registry credentials. For unhealthy API startup, check migration logs and the internal database/Valkey URLs. For login failures, check HTTPS, exact WEB_ORIGIN, the public build-time API URL, cookie scope and trusted proxy count.

Official references: [CapRover deployment action](https://github.com/caprover/deploy-from-github), [Docker Actions](https://docs.docker.com/build/ci/github-actions/), [pnpm production deploy](https://pnpm.io/10.x/cli/deploy), [PostgreSQL image data layout](https://hub.docker.com/_/postgres).

Production stages use Node.js 24.22.1 on Debian 13 (trixie-slim). The build stages retain bookworm-slim for reusable tooling layers; no build-stage operating-system files are copied into runtime images. The runtime base was selected after the critical-vulnerability scan flagged the older Debian zlib package.

## AI settings and request deadlines

Phase 6 adds the optional AI quota, timeout, pricing and trusted Ollama origins described in [the LLM deployment guide](llm-and-resume-import.md). Configure the same encryption key versions and quota settings on API and worker. Keep only your trusted Ollama origin in the administrator allowlist when using a remote or internal instance.

PDF import and synchronous resume embeddings can outlast a standard short proxy timeout. In the API app's custom Nginx configuration, set `proxy_read_timeout 90s;` and `proxy_send_timeout 90s;` in the appropriate server/location context for the default AI limits. Adjust the proxy and browser timeout together if increasing the AI deadlines or retries. No credentials belong in Nginx configuration.

## Phase 8: scoring deployment

Configure SCORING_LLM_TOP_N in the worker (default 30, range 0–100). Apply the updated API before the worker so migration 20261105210000_job_scoring exists before queue recovery. The release workflow submits apps in API → worker → web order; review API migration logs and health before proceeding with a manual deployment. The worker never runs migrations. See [scoring and offers](scoring-and-offers.md) for private vectors, durable attempt budgets and verification.

## Phase 9: email alerts

The worker now consumes IMAP alerts during collection. Configure the encrypted mailbox password and authorized senders in Settings. Keep `ALLOW_PRIVATE_IMAP_HOST=false` unless an internal mailbox is explicitly intended; TLS validation stays mandatory. Apply API migration `20261105223000_email_alerts` before deploying the worker. Configure the optional sender restriction and bounds described in [email alerts](email-alerts.md). Dovecot is a disposable test dependency, not an additional production service.
