import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
export class Passwords {
  private dummy = '';
  async initialize(): Promise<void> {
    this.dummy = await this.hash(randomBytes(32).toString('base64'));
  }
  hash(value: string): Promise<string> {
    return hash(value, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  async verify(encoded: string | undefined, value: string): Promise<boolean> {
    try {
      const valid = await verify(encoded ?? this.dummy, value);
      return encoded !== undefined && valid;
    } catch {
      await verify(this.dummy, value);
      return false;
    }
  }
}
