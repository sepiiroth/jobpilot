import { z } from 'zod';
import {
  loginSchema,
  currentUserSchema,
  csrfResponseSchema as csrfSchema,
  loginResponseSchema,
  type LoginInput,
  type CurrentUser,
} from '@jobpilot/shared';
import { apiOrigin } from './environment.ts';
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function createApiClient(fetcher: typeof fetch = fetch) {
  let csrfToken: string | undefined;
  let pendingCsrf: Promise<string> | undefined;
  async function send(path: string, options: RequestInit = {}) {
    const response = await fetcher(apiOrigin + path, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(await response.json().catch(() => null));
      throw new ApiClientError(
        response.status,
        error.success ? error.data.error.code : 'REQUEST_FAILED',
      );
    }
    return response.json() as Promise<unknown>;
  }
  async function getCsrf() {
    if (csrfToken) return csrfToken;
    if (!pendingCsrf)
      pendingCsrf = send('/auth/csrf')
        .then((value) => {
          csrfToken = csrfSchema.parse(value).csrfToken;
          return csrfToken;
        })
        .finally(() => {
          pendingCsrf = undefined;
        });
    return pendingCsrf;
  }
  async function write(path: string, payload: unknown) {
    const perform = async () =>
      send(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': await getCsrf(),
        },
        body: JSON.stringify(payload),
      });
    try {
      return await perform();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'CSRF_INVALID') {
        csrfToken = undefined;
        return perform();
      }
      throw error;
    }
  }
  return {
    async me(): Promise<CurrentUser | null> {
      try {
        return currentUserSchema.parse(await send('/auth/me'));
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          csrfToken = undefined;
          return null;
        }
        throw error;
      }
    },
    async login(input: LoginInput) {
      const result = loginResponseSchema.parse(
        await write('/auth/login', loginSchema.parse(input)),
      );
      csrfToken = result.csrfToken;
      return result.user;
    },
    async logout() {
      await write('/auth/logout', {});
      csrfToken = undefined;
    },
  };
}
export const apiClient = createApiClient();
