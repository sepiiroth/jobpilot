import { it, expect } from 'vitest';
import { contentSecurityPolicy } from './security';
import { parseApiOrigin } from './environment';
it('uses nonce-based scripts in production without eval or inline scripts', () => {
  const policy = contentSecurityPolicy('https://api.example.invalid', 'nonce');
  expect(policy).toContain("script-src 'self' 'nonce-nonce' 'strict-dynamic'");
  expect(policy).not.toContain('unsafe-eval');
  expect(policy).toContain("frame-ancestors 'none'");
});
it('rejects private configuration formats for the public API origin', () => {
  expect(() => parseApiOrigin('javascript:alert(1)')).toThrow();
  expect(() => parseApiOrigin('https://api.example.invalid/path')).toThrow();
  expect(parseApiOrigin('https://api.example.invalid')).toBe(
    'https://api.example.invalid',
  );
});
