import { z } from 'zod';
const origin = z.url().refine((value) => {
  const u = new URL(value);
  return ['http:', 'https:'].includes(u.protocol) && u.origin === value;
});
const rateSchema = z.object({
  inputPerMillion: z.number().finite().nonnegative().max(1000000),
  outputPerMillion: z.number().finite().nonnegative().max(1000000),
});
export const llmEnvironmentSchema = z.object({
  EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine(
      (v) => v === 1024,
      'Requires a vector schema migration when changed',
    )
    .default(1024),
  LLM_MONTHLY_TOKEN_LIMIT: z.coerce
    .number()
    .int()
    .min(0)
    .max(2_000_000_000)
    .default(2_000_000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  LLM_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(16384)
    .default(8192),
  DEFAULT_LLM_PROVIDER: z
    .enum(['anthropic', 'openai', 'mistral', 'ollama'])
    .default('anthropic'),
  OLLAMA_BASE_URL: origin.default('http://localhost:11434'),
  OLLAMA_ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:11434,http://127.0.0.1:11434,http://srv-captain--ollama:11434',
    )
    .transform((v) => v.split(',').map((v) => v.trim()))
    .pipe(z.array(origin).min(1)),
  LLM_PRICING_JSON: z
    .string()
    .default('{}')
    .transform((v, ctx) => {
      try {
        return z.record(z.string(), rateSchema).parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid pricing map' });
        return z.NEVER;
      }
    }),
});
export type LlmEnvironment = z.infer<typeof llmEnvironmentSchema>;
