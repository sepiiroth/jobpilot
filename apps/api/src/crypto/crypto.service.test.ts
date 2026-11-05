import { it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CryptoService } from './crypto.service.ts';
it('authenticates ciphertext, context and version, and rotates old keys', () => {
  const key = randomBytes(32).toString('base64');
  const current = randomBytes(32).toString('base64');
  const previous = new CryptoService({
    ENCRYPTION_KEY: key,
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  const value = randomBytes(32).toString('hex');
  const encrypted = previous.encrypt(value, 'user:source');
  expect(previous.decrypt(encrypted, 'user:source')).toBe(value);
  expect(encrypted.ciphertext.toString()).not.toBe(value);
  expect(previous.encrypt(value, 'user:source').iv).not.toEqual(encrypted.iv);
  expect(() => previous.decrypt(encrypted, 'other:source')).toThrow();
  expect(() =>
    previous.decrypt(
      { ...encrypted, ciphertext: Buffer.from('tampered') },
      'user:source',
    ),
  ).toThrow();
  expect(() =>
    previous.decrypt({ ...encrypted, keyVersion: 99 }, 'user:source'),
  ).toThrow();
  const next = new CryptoService({
    ENCRYPTION_KEY: current,
    ENCRYPTION_KEY_VERSION: 2,
    ENCRYPTION_PREVIOUS_KEYS: { '1': key },
  });
  const rotated = next.rotate(encrypted, 'user:source');
  expect(rotated.keyVersion).toBe(2);
  expect(next.decrypt(rotated, 'user:source')).toBe(value);
  expect(() => previous.decrypt(rotated, 'user:source')).toThrow();
});

it('validates shared encryption environment defaults and rejects malformed keys', async () => {
  const { cryptoEnvironmentSchema } = await import('@jobpilot/shared/crypto');
  const key = randomBytes(32).toString('base64');
  expect(
    cryptoEnvironmentSchema.parse({ ENCRYPTION_KEY: key })
      .ENCRYPTION_KEY_VERSION,
  ).toBe(1);
  expect(
    cryptoEnvironmentSchema.parse({
      ENCRYPTION_KEY: key,
      ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ '2': key }),
    }).ENCRYPTION_PREVIOUS_KEYS['2'],
  ).toBe(key);
  for (const input of [
    { ENCRYPTION_KEY: 'short' },
    { ENCRYPTION_KEY: key, ENCRYPTION_PREVIOUS_KEYS: 'invalid json' },
    {
      ENCRYPTION_KEY: key,
      ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ bad: key }),
    },
    {
      ENCRYPTION_KEY: key,
      ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ '2': 'short' }),
    },
  ])
    expect(cryptoEnvironmentSchema.safeParse(input).success).toBe(false);
});
