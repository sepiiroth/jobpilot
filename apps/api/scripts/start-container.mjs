import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseEnvironment } from '../src/config/environment.ts';
const require = createRequire(import.meta.url);
try {
  parseEnvironment(process.env);
  const args = [
    require.resolve('prisma/build/index.js'),
    'migrate',
    'deploy',
    '--config',
    require
      .resolve('@jobpilot/db')
      .replace(/src\/index\.ts$/, 'prisma.config.ts'),
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Migration failed')),
    );
  });
  await import('../src/main.ts');
} catch {
  console.error(
    'API startup stopped: configuration or database migration failed',
  );
  process.exitCode = 1;
}
