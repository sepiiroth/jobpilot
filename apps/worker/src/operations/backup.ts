import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

export function postgresEnvironment(url: string): NodeJS.ProcessEnv {
  const value = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(value.protocol))
    throw new Error('Invalid database URL');
  const ssl = value.searchParams.get('sslmode') ?? 'prefer';
  if (
    ![
      'disable',
      'allow',
      'prefer',
      'require',
      'verify-ca',
      'verify-full',
    ].includes(ssl)
  )
    throw new Error('Invalid PostgreSQL SSL mode');
  return {
    ...process.env,
    PGHOST: value.hostname,
    PGPORT: value.port || '5432',
    PGDATABASE: decodeURIComponent(value.pathname.slice(1)),
    PGUSER: decodeURIComponent(value.username),
    PGPASSWORD: decodeURIComponent(value.password),
    PGSSLMODE: ssl,
    PGCONNECT_TIMEOUT: '15',
  };
}
function completion(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    child.once('error', () =>
      reject(new Error('Backup executable unavailable')),
    );
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Backup process failed')),
    );
  });
}
/** Only encrypted bytes touch disk; credentials stay out of argv and logs. */
export async function encryptedBackup(
  databaseUrl: string,
  recipient: string,
  upload: (file: string, key: string, size: number) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'jobpilot-backup-'));
  const file = join(directory, 'database.dump.age');
  let dump: ChildProcess | undefined, age: ChildProcess | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600000);
  try {
    dump = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
      env: postgresEnvironment(databaseUrl),
      stdio: ['ignore', 'pipe', 'ignore'],
      signal: controller.signal,
      windowsHide: true,
    });
    age = spawn('age', ['--encrypt', '--recipient', recipient], {
      stdio: ['pipe', 'pipe', 'ignore'],
      signal: controller.signal,
      windowsHide: true,
    });
    await Promise.all([
      completion(dump),
      completion(age),
      pipeline(dump.stdout!, age.stdin!, { signal: controller.signal }),
      pipeline(
        age.stdout!,
        createWriteStream(file, { flags: 'wx', mode: 0o600 }),
        { signal: controller.signal },
      ),
    ]);
    const size = (await stat(file)).size;
    if (size === 0 || size > 5_000_000_000)
      throw new Error('Backup outside single-upload size bounds');
    const key =
      'jobpilot/' +
      new Date().toISOString().replaceAll(':', '-') +
      '-' +
      randomUUID() +
      '.dump.age';
    await upload(file, key, size);
  } catch {
    throw new Error('Encrypted backup failed');
  } finally {
    clearTimeout(timer);
    dump?.kill();
    age?.kill();
    await rm(directory, { recursive: true, force: true });
  }
}
