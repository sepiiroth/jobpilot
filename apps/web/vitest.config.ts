import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { env: { NEXT_PUBLIC_API_URL: 'http://localhost:3001' } },
});
