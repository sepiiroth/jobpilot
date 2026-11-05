import { it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createApiClient, ApiClientError } from './api-client';
const user = {
  id: '019a4eaa-0000-7000-8000-000000000001',
  email: 'test@example.invalid',
  locale: 'fr',
  createdAt: new Date().toISOString(),
};
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
it('uses cookies and signed CSRF for login and rotates CSRF before logout', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ csrfToken: 'guest-token' }))
    .mockResolvedValueOnce(response({ user, csrfToken: 'session-token' }))
    .mockResolvedValueOnce(response({ ok: true }));
  const client = createApiClient(fetcher);
  await client.login({
    email: user.email,
    password: randomBytes(24).toString('hex'),
  });
  await client.logout();
  expect(fetcher.mock.calls[0]?.[1]?.credentials).toBe('include');
  expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
    'X-CSRF-Token': 'guest-token',
  });
  expect(fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({
    'X-CSRF-Token': 'session-token',
  });
});
it('refreshes stale CSRF once and propagates failure', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ csrfToken: 'stale' }))
    .mockResolvedValueOnce(response({ error: { code: 'CSRF_INVALID' } }, 403))
    .mockResolvedValueOnce(response({ csrfToken: 'fresh' }))
    .mockResolvedValueOnce(
      response({ error: { code: 'INVALID_CREDENTIALS' } }, 401),
    );
  await expect(
    createApiClient(fetcher).login({
      email: user.email,
      password: randomBytes(24).toString('hex'),
    }),
  ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('treats expired sessions as signed out and preserves service failures', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({ error: { code: 'UNAUTHENTICATED' } }, 401),
    )
    .mockResolvedValueOnce(
      response({ error: { code: 'INTERNAL_ERROR' } }, 500),
    );
  const client = createApiClient(fetcher);
  expect(await client.me()).toBeNull();
  await expect(client.me()).rejects.toBeInstanceOf(ApiClientError);
});
it('validates successful responses and shares concurrent CSRF requests', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ csrfToken: 'shared' }))
    .mockImplementation(async () => response({ ok: true }));
  const client = createApiClient(fetcher);
  await Promise.all([client.logout(), client.logout()]);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/csrf')),
  ).toHaveLength(1);
  const invalid = createApiClient(
    vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'invalid' })),
  );
  await expect(invalid.me()).rejects.toThrow();
});
