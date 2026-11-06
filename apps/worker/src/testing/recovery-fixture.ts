import { encryptedBackup, postgresEnvironment } from '../operations/backup.ts';
import { restoreBackup } from '../operations/restore.ts';
import { createDatabaseClient } from '@jobpilot/db';
import { CryptoService } from '@jobpilot/shared/crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.RECOVERY_TEST_MODE !== 'isolated'
)
  throw new Error('Isolated recovery test only');
const sourceUrl = process.env.DATABASE_URL!;
const targetUrl = new URL(
  process.env.RECOVERY_TARGET_DATABASE_URL ?? sourceUrl,
);
if (!process.env.RECOVERY_TARGET_DATABASE_URL)
  targetUrl.pathname = '/jobpilot_restore_target';
const source = createDatabaseClient(sourceUrl),
  target = createDatabaseClient(targetUrl.href);
const directory = await mkdtemp(join(tmpdir(), 'jobpilot-recovery-test-'));
let stage = 'create empty database';
try {
  if (!process.env.RECOVERY_TARGET_DATABASE_URL)
    execFileSync(
      'psql',
      [
        '--no-psqlrc',
        '--set',
        'ON_ERROR_STOP=1',
        '--command',
        'CREATE DATABASE jobpilot_restore_target;',
      ],
      { env: postgresEnvironment(sourceUrl), stdio: 'pipe' },
    );
  const versions = await source.$queryRaw<
    Array<{ server: number; vector: string }>
  >`SELECT current_setting('server_version_num')::int AS server,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector`;
  assert.ok(versions[0]!.server >= 180004);
  assert.equal(versions[0]!.vector, '0.8.2');
  stage = 'validate worker backup configuration';
  const configSecret = randomBytes(32).toString('hex');
  const configEnv = {
    ...process.env,
    VALKEY_URL: 'redis://127.0.0.1:1',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BACKUP_S3_ENDPOINT: 'https://s3.example.invalid',
    BACKUP_S3_BUCKET: 'synthetic-bucket',
    BACKUP_S3_REGION: 'us-east-1',
    BACKUP_S3_ACCESS_KEY: randomBytes(12).toString('hex'),
    BACKUP_S3_SECRET_KEY: configSecret,
    BACKUP_AGE_RECIPIENT: 'age1' + 'q'.repeat(58),
  };
  for (const partial of [true, false]) {
    const check = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/main.ts'],
      {
        env: { ...configEnv, ...(partial ? { BACKUP_S3_SECRET_KEY: '' } : {}) },
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      },
    );
    assert.equal(check.status, 1);
    assert.ok(
      check.stderr.includes(
        partial
          ? 'Complete backup configuration required'
          : 'BACKUP_AGE_RECIPIENT (age validation failed)',
      ),
    );
    assert.equal((check.stdout + check.stderr).includes(configSecret), false);
  }
  stage = 'seed source database';
  const key = randomBytes(32).toString('base64');
  const crypto = new CryptoService({
    ENCRYPTION_KEY: key,
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  const user = await source.user.create({
    data: {
      email: 'recovery@example.invalid',
      passwordHash: 'synthetic-not-a-login-hash',
    },
  });
  const resume = await source.resume.create({
    data: {
      userId: user.id,
      title: 'Recovery synthetic resume',
      data: {
        basics: { name: 'Synthetic Recovery Example' },
        skills: [{ name: 'TypeScript' }],
      },
      embeddingStatus: 'ready',
    },
  });
  const vector = [1, ...Array<number>(1023).fill(0)];
  await source.$executeRaw`UPDATE resumes SET embedding=${JSON.stringify(vector)}::vector WHERE id=${resume.id}::uuid`;
  const offer = await source.jobOffer.create({
    data: {
      sourceId: 'greenhouse',
      externalId: 'recovery-demo',
      dedupKey: 'synthetic-recovery',
      url: 'https://example.invalid/recovery',
      title: 'Synthetic engineer',
      company: 'Synthetic company',
      description: 'Synthetic fixture',
      location: { city: 'Lyon', country: 'FR' },
      remote: 'unknown',
      contractType: 'unknown',
    },
  });
  const document = await source.generatedDocument.create({
    data: {
      userId: user.id,
      resumeId: resume.id,
      jobOfferId: offer.id,
      kind: 'resume',
      version: 1,
      content: { kind: 'resume', data: resume.data },
      params: {},
      integrityReport: {},
      model: 'synthetic',
      tokensIn: 0,
      tokensOut: 0,
    },
  });
  await source.application.create({
    data: {
      userId: user.id,
      jobOfferId: offer.id,
      resumeDocId: document.id,
      notes: 'Synthetic recovery note',
      status: 'interview',
      appliedAt: new Date('2026-11-01'),
    },
  });
  const plaintext = randomBytes(32).toString('base64url');
  const secret = crypto.encrypt(plaintext, user.id + ':llm_openai');
  await source.userSecret.create({
    data: {
      userId: user.id,
      kind: 'llm_openai',
      ...secret,
      ciphertext: new Uint8Array(secret.ciphertext),
      iv: new Uint8Array(secret.iv),
      authTag: new Uint8Array(secret.authTag),
    },
  });
  await source.session.create({
    data: {
      userId: user.id,
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  stage = 'create age identity';
  const identity = join(directory, 'identity.txt');
  execFileSync('age-keygen', ['-o', identity], { stdio: 'pipe' });
  const recipient = execFileSync('age-keygen', ['-y', identity], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const archive = join(directory, 'database.dump.age');
  let temporary = '';
  stage = 'encrypt snapshot';
  await encryptedBackup(sourceUrl, recipient, async (file, key, size) => {
    temporary = file;
    assert.match(key, /\.dump\.age$/);
    assert.ok(size > 100);
    const bytes = await readFile(file);
    assert.ok(
      bytes.subarray(0, 22).toString().startsWith('age-encryption.org/v1'),
    );
    assert.equal(
      bytes.includes(Buffer.from('Synthetic Recovery Example')),
      false,
    );
    assert.equal(bytes.includes(Buffer.from(plaintext)), false);
    await copyFile(file, archive);
  });
  await assert.rejects(readFile(temporary));
  stage = 'clean failed upload';
  await assert.rejects(
    encryptedBackup(sourceUrl, recipient, async (file) => {
      temporary = file;
      throw new Error('Synthetic upload failure');
    }),
    /Encrypted backup failed/,
  );
  await assert.rejects(readFile(temporary));
  stage = 'reject wrong decryption key';
  const wrongIdentity = join(directory, 'wrong-identity.txt');
  execFileSync('age-keygen', ['-o', wrongIdentity], { stdio: 'pipe' });
  await assert.rejects(
    restoreBackup(targetUrl.href, wrongIdentity, archive),
    /Encrypted restore failed/,
  );
  assert.equal(
    (
      await target.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) AS count FROM pg_tables WHERE schemaname='public'`
    )[0]?.count,
    0n,
  );
  stage = 'restore archive';
  await restoreBackup(targetUrl.href, identity, archive);
  stage = 'verify target extension and server';
  await target.$executeRaw`ALTER EXTENSION vector UPDATE TO '0.8.7'`;
  const targetVersions = await target.$queryRaw<
    Array<{ server: number; vector: string }>
  >`SELECT current_setting('server_version_num')::int AS server,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector`;
  assert.ok(targetVersions[0]!.server >= 180006);
  assert.equal(targetVersions[0]!.vector, '0.8.7');
  stage = 'verify restored content';
  assert.deepEqual(
    (await target.resume.findUniqueOrThrow({ where: { id: resume.id } })).data,
    resume.data,
  );
  assert.equal(
    (await target.application.findFirstOrThrow()).notes,
    'Synthetic recovery note',
  );
  assert.equal((await target.generatedDocument.findFirstOrThrow()).version, 1);
  assert.equal(await target.session.count(), 0);
  assert.equal(
    await target.$queryRaw<
      Array<{ dimension: number }>
    >`SELECT vector_dims(embedding) AS dimension FROM resumes WHERE id=${resume.id}::uuid`.then(
      (rows) => rows[0]?.dimension,
    ),
    1024,
  );
  const restored = await target.userSecret.findFirstOrThrow();
  assert.equal(
    crypto.decrypt(
      {
        ...restored,
        ciphertext: Buffer.from(restored.ciphertext),
        iv: Buffer.from(restored.iv),
        authTag: Buffer.from(restored.authTag),
      },
      user.id + ':llm_openai',
    ),
    plaintext,
  );
  stage = 'verify all table counts';
  const counts = async (db: typeof source) =>
    Promise.all([
      db.user.count(),
      db.userSettings.count(),
      db.userSecret.count(),
      db.resume.count(),
      db.search.count(),
      db.trackedCompany.count(),
      db.jobOffer.count(),
      db.userJobMatch.count(),
      db.collectionRun.count(),
      db.generatedDocument.count(),
      db.application.count(),
      db.llmUsage.count(),
      db.auditLog.count(),
      db.collectionStep.count(),
      db.collectionItem.count(),
      db.jobOfferAlias.count(),
      db.offerEmbedding.count(),
      db.scoringTask.count(),
      db.searchMatch.count(),
      db.emailMailbox.count(),
      db.emailMessage.count(),
      db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) AS count FROM _prisma_migrations`.then((rows) =>
        Number(rows[0]?.count ?? 0),
      ),
    ]);
  assert.deepEqual(await counts(target), await counts(source));
  await assert.rejects(
    restoreBackup(targetUrl.href, identity, archive),
    /empty database/,
  );
  console.log(
    'PASS: encrypted archive restored into an empty PostgreSQL database; all table counts, vector, CV, application, document and encrypted credential verified; sessions revoked; nonempty target rejected; ciphertext cleaned',
  );
} catch (error) {
  console.log(
    'FAIL: recovery stage ' +
      stage +
      ' (' +
      (error instanceof Error ? error.name : 'unknown') +
      ')',
  );
  throw new Error('Recovery verification failed');
} finally {
  await source.$disconnect();
  await target.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
