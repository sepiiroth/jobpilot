export function contentSecurityPolicy(
  apiOrigin: string,
  nonce?: string,
  development = false,
): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${nonce ? "'nonce-" + nonce + "' 'strict-dynamic'" : "'unsafe-inline'"}${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self' ${apiOrigin}${development ? ' ws: wss:' : ''}`,
  ].join('; ');
}
