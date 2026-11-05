import { LlmError } from './errors.ts';
export function guardedFetch(
  allowedOrigins: string[],
  transport: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (!allowedOrigins.includes(url.origin) || url.username || url.password)
      throw new LlmError('LLM_ENDPOINT_FORBIDDEN');
    const response = await transport(input, { ...init, redirect: 'error' });
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new LlmError('LLM_INVALID_OUTPUT');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
