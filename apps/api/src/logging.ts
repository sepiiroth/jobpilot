import type { Options } from 'pino-http';
export function loggingOptions(level: string): Options {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        'password',
        'passwordHash',
        'token',
        'tokenHash',
        'secret',
        'ciphertext',
        'iv',
        'authTag',
        'body',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        path: req.url.split('?')[0],
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: () => ({ type: 'RequestError' }),
    },
  };
}
