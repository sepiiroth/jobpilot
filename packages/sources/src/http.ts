import { fetch } from 'undici';
import { SourceError } from './types.ts';
const hosts = [
  'api.adzuna.com',
  'boards-api.greenhouse.io',
  'api.lever.co',
  'api.ashbyhq.com',
];
export type JsonTransport = (
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
) => Promise<{ status: number; value: unknown; retryAfterMs?: number }>;
export const sourceTransport: JsonTransport = async (url, headers, signal) => {
  const response = await fetch(url, { headers, signal, redirect: 'error' });
  if (!response.ok) {
    await response.body?.cancel();
    const retryAfter = response.headers.get('retry-after') ?? '0';
    const delay = /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter) - Date.now();
    return {
      status: response.status,
      value: null,
      retryAfterMs: Number.isFinite(delay) ? Math.max(0, delay) : 0,
    };
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError('SOURCE_INVALID_RESPONSE');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new SourceError('SOURCE_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return {
      status: response.status,
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
    };
  } catch {
    throw new SourceError('SOURCE_INVALID_RESPONSE');
  }
};
export class SourceHttp {
  constructor(
    private readonly userAgent: string,
    private readonly permit: (source: string) => Promise<void>,
    private readonly maxRequests: number,
    private readonly transport: JsonTransport = sourceTransport,
  ) {}
  private requests = 0;
  async get(url: URL, source: string): Promise<unknown> {
    if (
      url.protocol !== 'https:' ||
      !hosts.includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      throw new SourceError('SOURCE_ENDPOINT_FORBIDDEN');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++this.requests > this.maxRequests)
        throw new SourceError('COLLECTION_REQUEST_LIMIT');
      await this.permit(source);
      try {
        const response = await this.transport(
          url,
          { 'User-Agent': this.userAgent, Accept: 'application/json' },
          AbortSignal.timeout(15000),
        );
        if (response.status >= 200 && response.status < 300)
          return response.value;
        if (response.status === 429 && response.retryAfterMs) {
          if (response.retryAfterMs > 60000)
            throw new SourceError('SOURCE_RATE_LIMITED');
          await new Promise((resolve) =>
            setTimeout(resolve, response.retryAfterMs),
          );
        }
        if (response.status === 401 || response.status === 403)
          throw new SourceError('SOURCE_AUTH_FAILED');
        if (response.status !== 429 && response.status < 500)
          throw new SourceError('SOURCE_UNAVAILABLE');
      } catch (error) {
        if (error instanceof SourceError) throw error;
      }
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
    throw new SourceError('SOURCE_UNAVAILABLE');
  }
}
