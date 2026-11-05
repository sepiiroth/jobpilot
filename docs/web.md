# Web application (phase 3)

The Next.js App Router application provides French navigation, authentication and empty workspace pages. Collection, resume editing and application tracking are implemented in later phases. The collection button is intentionally disabled.

## Setup

Set NEXT_PUBLIC_API_URL to the exact API origin in the ignored root .env file. WEB_ORIGIN on the API must match the web origin exactly. Defaults for local use are http://localhost:3001 and http://localhost:3000. APP_NAME configures the visible name through server-rendered components. The only public environment variable required by client code is NEXT_PUBLIC_API_URL.

Run:

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm --filter @jobpilot/api start
# In a second terminal:
pnpm --filter @jobpilot/web dev
```

Open http://localhost:3000. Create an account through the API CLI described in api-authentication.md. There is no registration form. The web launcher loads the root environment and selects the correct NODE_ENV for dev, build and start; the root development value does not override a production build.

## Authentication and boundaries

The browser calls only the NestJS API with credentials included. Login schemas and response validation are shared through @jobpilot/shared. The client fetches a signed CSRF token, retains the login replacement in memory and refreshes once if the server rejects a stale token. Passwords are not placed in query strings or browser storage.

Protected layouts show a loading state until GET /auth/me succeeds, redirect to /connexion when signed out and offer retry when the API is unavailable. This works with API host-only cookies across subdomains; the web server does not need to read them. The API performs authoritative access control. Server-rendered workspace children contain only the static phase 3 shell, never user records. Session validation runs again on window focus and periodically. Logout revokes the API session, clears the query cache and redirects to login.

CSP is configured in next.config.ts and strengthened with a fresh request nonce by the Node-runtime proxy. Next scripts and the theme initializer receive that nonce. Production scripts disallow eval; development permits it for Next tooling. Inline styles remain allowed for Radix positioning and theme styles. External images and remote fonts are unused. Image optimization is disabled. HSTS remains a reverse-proxy deployment concern.

French messages live in apps/web/messages/fr.json and are loaded through next-intl. Adding another locale does not require rewriting UI components. next-themes provides light, dark and system modes. shadcn components are kept under components/ui; product styling and the translated mobile sidebar live outside that directory.

## Validation

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm --filter @jobpilot/web build
pnpm --filter @jobpilot/web verify:client
pnpm --filter @jobpilot/web start
```

verify:client scans production browser chunks for private configuration references and configured server credential values without printing them. The tests cover CSRF renewal, cookies, session expiration handling, concurrent CSRF initialization, response validation and CSP configuration. Browser interaction was checked against the real local API with a synthetic temporary account. No Playwright test suite is introduced in this phase.

Lighthouse measured login accessibility at 100/100 on November 5, 2026 using the installed Chromium-based browser. This is an automated accessibility result; keyboard and responsive checks were also performed during browser verification.

The generated Sonner component has one maintainer-approved type annotation correction: its theme assertion uses NonNullable to support exactOptionalPropertyTypes without changing runtime behavior.

Production build and client-bundle verification passed after the approved Sonner annotation correction. The production server was checked with Node.js 24.22.1, and Lighthouse also measured production login accessibility at 100/100. The synthetic browser QA account was removed after verification.
