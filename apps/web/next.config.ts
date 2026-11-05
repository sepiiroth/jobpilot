import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';
import { apiOrigin } from './src/lib/environment.ts';
import { contentSecurityPolicy } from './src/lib/security.ts';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  images: { unoptimized: true },
  poweredByHeader: false,
  transpilePackages: ['@jobpilot/shared'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy(
              apiOrigin,
              undefined,
              process.env.NODE_ENV === 'development',
            ),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default createNextIntlPlugin('./src/i18n/request.ts')(config);
