import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
process.env.NODE_ENV = process.argv[2] === 'dev' ? 'development' : 'production';
await import('next/dist/bin/next');
