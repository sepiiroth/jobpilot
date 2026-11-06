import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { postgresEnvironment } from './backup.ts';
const execute = promisify(execFile);
/** Restore only a trusted encrypted archive into an explicitly empty database. */
export async function restoreBackup(
  url: string,
  identityFile: string,
  archiveFile: string,
) {
  const env = postgresEnvironment(url);
  const options = {
    env,
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  };
  const result = await execute(
    'psql',
    [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')",
    ],
    options,
  );
  if (result.stdout.trim() !== '0')
    throw new Error('Restore requires an empty database');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600000);
  const age = spawn(
    'age',
    ['--decrypt', '--identity', identityFile, archiveFile],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      signal: controller.signal,
      windowsHide: true,
    },
  );
  const restore = spawn(
    'pg_restore',
    [
      '--dbname',
      env.PGDATABASE!,
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-acl',
    ],
    {
      env,
      stdio: ['pipe', 'ignore', 'ignore'],
      signal: controller.signal,
      windowsHide: true,
    },
  );
  const done = (child: ReturnType<typeof spawn>) =>
    new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('Restore tool unavailable')));
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Restore process failed')),
      );
    });
  try {
    await Promise.all([
      done(age),
      done(restore),
      pipeline(age.stdout!, restore.stdin!, { signal: controller.signal }),
    ]);
    // Backups must never revive sessions that were revoked after the snapshot.
    await execute(
      'psql',
      [
        '--no-psqlrc',
        '--set',
        'ON_ERROR_STOP=1',
        '--command',
        'DELETE FROM sessions;',
      ],
      options,
    );
  } catch {
    throw new Error('Encrypted restore failed');
  } finally {
    clearTimeout(timer);
    age.kill();
    restore.kill();
  }
}
