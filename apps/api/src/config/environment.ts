import { llmEnvironmentSchema } from '@jobpilot/llm/config';
import { z } from 'zod';
const key = z
  .string()
  .refine(
    (v) =>
      Buffer.from(v, 'base64').length === 32 &&
      Buffer.from(v, 'base64').toString('base64') === v,
    'Expected 32 bytes in canonical base64',
  );
export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    DATABASE_URL: z
      .url()
      .refine((v) =>
        ['postgres:', 'postgresql:'].includes(new URL(v).protocol),
      ),
    VALKEY_URL: z
      .url()
      .refine((v) => ['redis:', 'rediss:'].includes(new URL(v).protocol)),
    ENCRYPTION_KEY: key,
    SESSION_SECRET: key,
    ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
    ENCRYPTION_PREVIOUS_KEYS: z
      .string()
      .default('{}')
      .transform((v, ctx) => {
        try {
          return z
            .record(z.string().regex(/^[1-9]\d*$/), key)
            .parse(JSON.parse(v));
        } catch {
          ctx.addIssue({
            code: 'custom',
            message: 'Invalid previous encryption keys',
          });
          return z.NEVER;
        }
      }),
    WEB_ORIGIN: z
      .url()
      .refine(
        (v) =>
          ['http:', 'https:'].includes(new URL(v).protocol) &&
          new URL(v).origin === v,
        'Expected an exact HTTP origin without trailing slash',
      ),
    COOKIE_DOMAIN: z.string().default(''),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_HOST: z.string().default('127.0.0.1'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    REGISTRATION_ENABLED: z.enum(['false', 'true']).default('false'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_NAME: z.string().default('JobPilot'),
  })
  .extend(llmEnvironmentSchema.shape)
  .superRefine((v, c) => {
    if (v.NODE_ENV === 'production' && !v.WEB_ORIGIN.startsWith('https://'))
      c.addIssue({
        code: 'custom',
        message: 'Production requires an HTTPS web origin',
      });
    if (v.ENCRYPTION_PREVIOUS_KEYS[String(v.ENCRYPTION_KEY_VERSION)])
      c.addIssue({
        code: 'custom',
        message:
          'Current encryption key version cannot appear in previous keys',
      });
  });
export type Environment = z.infer<typeof environmentSchema>;
export function parseEnvironment(input: unknown): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid configuration: ' +
        result.error.issues
          .map((i) => i.path.join('.') + ': ' + i.message)
          .join('; '),
    );
  return result.data;
}
