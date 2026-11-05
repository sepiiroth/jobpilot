import { z } from 'zod';
const urlSchema = z
  .url()
  .refine(
    (value) =>
      ['http:', 'https:'].includes(new URL(value).protocol) &&
      new URL(value).origin === value,
    'Expected an HTTP origin without trailing slash',
  );
export function parseApiOrigin(value: unknown): string {
  const result = urlSchema.safeParse(value);
  if (!result.success)
    throw new Error('NEXT_PUBLIC_API_URL must be a valid HTTP origin');
  return result.data;
}
export const apiOrigin = parseApiOrigin(process.env.NEXT_PUBLIC_API_URL);
