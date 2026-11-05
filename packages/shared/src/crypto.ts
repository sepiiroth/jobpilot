import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
const keySchema = z
  .string()
  .refine(
    (v) =>
      Buffer.from(v, 'base64').length === 32 &&
      Buffer.from(v, 'base64').toString('base64') === v,
  );
export const cryptoEnvironmentSchema = z.object({
  ENCRYPTION_KEY: keySchema,
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  ENCRYPTION_PREVIOUS_KEYS: z
    .string()
    .default('{}')
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid encryption key map' });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string().regex(/^[1-9]\d*$/), keySchema)),
});
interface CryptoConfiguration {
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_VERSION: number;
  ENCRYPTION_PREVIOUS_KEYS: Record<string, string>;
}
export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}
export class CryptoService {
  private readonly keys: Map<number, Buffer>;
  private readonly current: number;
  constructor(config: CryptoConfiguration) {
    this.current = config.ENCRYPTION_KEY_VERSION;
    this.keys = new Map(
      Object.entries(config.ENCRYPTION_PREVIOUS_KEYS).map(([v, k]) => [
        Number(v),
        Buffer.from(k, 'base64'),
      ]),
    );
    this.keys.set(this.current, Buffer.from(config.ENCRYPTION_KEY, 'base64'));
  }
  encrypt(value: string, context: string): EncryptedSecret {
    const iv = randomBytes(12);
    const key = this.keys.get(this.current);
    if (!key) throw new Error('Encryption key unavailable');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    return {
      ciphertext: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]),
      iv,
      authTag: cipher.getAuthTag(),
      keyVersion: this.current,
    };
  }
  decrypt(value: EncryptedSecret, context: string): string {
    const key = this.keys.get(value.keyVersion);
    if (!key) throw new Error('Unknown encryption key version');
    const decipher = createDecipheriv('aes-256-gcm', key, value.iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(value.authTag);
    return Buffer.concat([
      decipher.update(value.ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
  rotate(value: EncryptedSecret, context: string): EncryptedSecret {
    return this.encrypt(this.decrypt(value, context), context);
  }
}
