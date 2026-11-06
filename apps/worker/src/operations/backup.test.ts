import { expect, it } from 'vitest';
import { postgresEnvironment } from './backup.ts';
it('passes PostgreSQL credentials through environment rather than executable arguments', () => {
  const url = new URL('postgresql://localhost/synthetic');
  url.username = 'example user';
  url.password = crypto.randomUUID();
  const env = postgresEnvironment(url.href);
  expect(env.PGHOST).toBe('localhost');
  expect(env.PGUSER).toBe('example user');
  expect(env.PGDATABASE).toBe('synthetic');
  expect(env.PGPASSWORD).toBe(url.password);
  expect(() => postgresEnvironment('https://example.invalid/db')).toThrow();
  expect(() =>
    postgresEnvironment('postgresql://localhost/db?sslmode=bogus'),
  ).toThrow();
});
