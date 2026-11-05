# LLM module and PDF resume import

## Setup and providers

Use Node.js 24.22.1 and pnpm 10.34.9. Apply `pnpm db:generate` and `pnpm db:migrate` before starting the API or worker. The migration adds resume revisions, embedding state/model metadata and usage reservations. It keeps existing master resumes and credential ciphertext unchanged.

Configure the generation/scoring provider and exact model IDs in **Paramètres**. Supported providers are Anthropic, OpenAI, Mistral and Ollama. Embeddings use an independently selected OpenAI, Mistral, Voyage AI or Ollama model. Cloud credentials remain encrypted and write-only. Ollama needs no cloud credential. No AI SDK or provider-specific SDK is imported outside `packages/llm`.

AI SDK 6 and all adapters are pinned to mutually compatible provider-v3 versions. Structured generation uses `generateText` with `Output.object()` and Zod validation. Text generation and embeddings use the same bounded, metered service. The Nest module is imported by API and worker; the worker does not start collection jobs in this phase.

No configured cloud credential means no cloud request. Configure providers deliberately before importing or calculating embeddings: these actions may incur provider charges and transmit personal data. Tests inject simulated providers and never use the stored local credentials.

## PDF import and review

On **CV**, choose a PDF and click **Préparer une proposition**. The API accepts a raw `application/pdf` request to `POST /resumes/import`, authenticated with the existing session and signed CSRF token.

- Maximum upload: 5 MiB, checked server-side as well as in the browser.
- Check the actual `%PDF-` signature; do not trust the extension or MIME type alone.
- Extraction runs in a separate worker thread with a 128 MiB heap limit and a 15-second deadline. At most two extractions run per API instance.
- Maximum 20 pages and 100,000 extracted UTF-8 bytes. No OCR is performed; scanned image-only PDFs need a selectable-text version.
- JavaScript evaluation, XFA and system font loading are disabled. The uploaded file is held in memory, never stored or served to another client.
- Extracted text is delimited as untrusted data in a versioned prompt. No tools, URL fetching or database access are granted to the model.

The response is a Zod-validated proposal plus warnings. It does not create or alter a master resume. Review the editable sections and check **J’ai vérifié et corrigé…** before saving. The proposal may still contain semantic mistakes even if its JSON is valid. Schema validation and prompt separation are defenses, not a guarantee that all prompt injections or invented facts are detectable.

## Embedding lifecycle

Every master-resume save preserves the manual data first, clears its previous vector, and attempts to compute the new embedding. Contact identity, email, phone and residence fields are excluded from embedding input; professional content is included.

- `ready`: computed and stored with provider/model metadata.
- `not_configured`: master saved; configure the embedding provider/credential.
- `failed`: master saved; retry from the CV editor after resolving configuration, provider, quota or model-dimension issues.
- `pending`: calculation is needed or a previous process was interrupted.

Saving embedding credentials or preferences starts best-effort recalculation of affected active CVs. A provider/model/endpoint change first invalidates the user's old vectors. The API serializes background passes per user and stores revision numbers; a late result cannot overwrite a newer CV or an embedding from newer settings. Background work is not a durable collection queue: after an interrupted API process, use **Recalculer les correspondances** or save the settings again. Archived CVs are not automatically recalculated.

`POST /resumes/:id/embedding` retries only the authenticated user's resume. A foreign ID returns 404 before any AI call.

The installed database columns and vector repository use 1024 dimensions. `EMBEDDING_DIMENSIONS` is validated as 1024; a different size needs a deliberate database/index migration and full recalculation. OpenAI and Voyage receive dimension options; Mistral and Ollama models must return 1024 values. Wrong-length, non-finite and zero vectors are rejected. Existing job-offer embeddings are not computed in this phase.

## Monthly usage and costs

`GET /llm/usage` returns only the authenticated user's current UTC-month usage summary. It is also shown in **Paramètres**. Every provider attempt has a `LlmUsage` record, including prompt version when applicable, model, provider, input/output tokens and status.

Before each attempt, a short PostgreSQL transaction acquires a per-user advisory lock and reserves a conservative token allowance. API and worker share the same database ledger. Concurrent requests cannot independently spend the same remaining allowance. Input estimates use UTF-8 byte lengths plus schema/protocol headroom; generation also reserves its maximum output allowance. Successful calls with known usage replace reservations with measured tokens. Calls with unknown usage, failures, timeouts or interrupted processes keep their allowance reserved until month end; this favors avoiding unaccounted spend over maximizing quota utilization. Each retry requires a fresh reservation.

This is an application token quota, not a provider-side monetary limit or a guarantee about a provider's billing. Set provider account spending limits as well when needed. Cached-token discounts, vendor-specific billing details and local hardware costs are not inferred.

Unknown prices are stored as `costEstimate = null`, never invented as free. Optionally configure `LLM_PRICING_JSON` using keys `provider:model` and objects with `inputPerMillion` / `outputPerMillion` rates in USD. Obtain those values from your own provider/account pricing. The UI marks estimates as partial while calls lack configured rates. Changes do not reprice old records.

## Environment and endpoint policy

All optional settings are documented in `.env.example` and validated at API and worker startup:

| Variable                  | Default                                                       | Meaning                                                    |
| ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `LLM_MONTHLY_TOKEN_LIMIT` | 2000000                                                       | Shared per-user monthly token allowance; zero blocks calls |
| `LLM_TIMEOUT_MS`          | 30000                                                         | Deadline per attempt, 100–120000 ms                        |
| `LLM_MAX_RETRIES`         | 1                                                             | Zero to two retries, only for retryable failures           |
| `LLM_MAX_OUTPUT_TOKENS`   | 8192                                                          | Maximum generated tokens, 256–16384                        |
| `LLM_PRICING_JSON`        | `{}`                                                          | Optional administrator-supplied rates                      |
| `OLLAMA_ALLOWED_ORIGINS`  | Localhost, loopback and internal Ollama service on port 11434 | Exact administrator-approved origins                       |
| `OLLAMA_BASE_URL`         | `http://localhost:11434`                                      | Default Ollama origin                                      |
| `DEFAULT_LLM_PROVIDER`    | `anthropic`                                                   | Default provider before preferences exist                  |
| `EMBEDDING_DIMENSIONS`    | 1024                                                          | Must match the installed schema                            |

Cloud origins are fixed to official provider API hosts. Redirects are refused and response bodies are capped at 2 MiB. User-supplied Ollama URLs must be origin-only and match `OLLAMA_ALLOWED_ORIGINS`; add your trusted instance origin explicitly before using it. No arbitrary private-network endpoint is accepted from a browser preference.

Requests are bounded and retries use exponential backoff. Invalid structured output and invalid configuration are not automatically retried. SDK telemetry and SDK warning logs are disabled. Application errors do not expose provider messages, keys, prompts, extracted text or generated content.

For imports and synchronous embeddings behind CapRover, ensure the reverse-proxy timeout covers your configured attempts and extraction deadline; for the defaults, allow at least 90 seconds. The browser allows up to 210 seconds for these operations. If increasing server limits beyond this, adjust the proxy and client timeout together.

## Verification

With Docker running:

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm audit --prod
pnpm --filter @jobpilot/web build
pnpm --filter @jobpilot/web verify:client
```

Tests exercise real adapters against in-memory HTTP fixtures, invalid output, the untrusted-offer injection string, dimension options, endpoint policy, real temporary PostgreSQL usage reservations, user isolation, import review separation, rejected PDF uploads, embedding failures and bounded timeout retries. They make no external AI requests.

References: [AI SDK structured outputs](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data), [OpenAI embedding dimensions](https://developers.openai.com/api/reference/resources/embeddings/methods/create), and the exact installed provider typings. No automatic Git or deployment operation is part of this phase.
