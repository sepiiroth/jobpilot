import { Redis } from 'ioredis';
import { OperationsRuntime } from '../operations/runtime.ts';
import { operationsEnvironmentSchema } from '@jobpilot/shared/operations';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Queue } from 'bullmq';
import {
  createDatabaseClient,
  CollectionRepository,
  Prisma,
  type PrismaClient,
} from '@jobpilot/db';
import {
  queueConnection,
  collectionEnvironmentSchema,
} from '@jobpilot/shared/collection';
import { CryptoService } from '@jobpilot/shared/crypto';
import {
  LlmService,
  LlmRepository,
  llmEnvironmentSchema,
  type LlmProvider,
} from '@jobpilot/llm';
import { GreenhouseSource, type JsonTransport } from '@jobpilot/sources';
import { CollectionRuntime, type RuntimeQueues } from './runtime.ts';
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      `../../packages/sources/src/__fixtures__/${name}.json`,
      'utf8',
    ),
  ) as Record<string, unknown>;
let pg: StartedTestContainer | undefined,
  vk: StartedTestContainer | undefined,
  db: PrismaClient,
  runtime: CollectionRuntime,
  queues: RuntimeQueues;
let userId = '',
  otherId = '',
  mode = 'failure';
let operationsConfig: {
  VALKEY_URL: string;
  COLLECTION_QUEUE_PREFIX: string;
  COLLECTION_COOLDOWN_MINUTES: number;
};
const requested: string[] = [];
const provider: LlmProvider = {
  async generateStructured() {
    throw new Error('Not part of collection');
  },
  async generateText() {
    throw new Error('Not part of collection');
  },
  async embed() {
    return {
      value: [1, ...Array<number>(1023).fill(0)],
      usage: { tokensIn: 10, tokensOut: 0 },
    };
  },
};
beforeAll(async () => {
  const password = randomBytes(24).toString('hex');
  pg = await new GenericContainer('jobpilot-db:phase12')
    .withEnvironment({
      POSTGRES_USER: 'jobpilot',
      POSTGRES_DB: 'jobpilot',
      POSTGRES_PASSWORD: password,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections', 2),
    )
    .start();
  vk = await new GenericContainer('valkey/valkey:8-alpine')
    .withCommand(['valkey-server', '--requirepass', password])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  const url = `postgresql://jobpilot:${password}@${pg.getHost() === 'localhost' ? '127.0.0.1' : pg.getHost()}:${pg.getMappedPort(5432)}/jobpilot`;
  const valkey = `redis://:${password}@${vk.getHost() === 'localhost' ? '127.0.0.1' : vk.getHost()}:${vk.getMappedPort(6379)}`;
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    {
      cwd: '../../packages/db',
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    },
  );
  db = createDatabaseClient(url);
  const config = {
    ...collectionEnvironmentSchema.parse({
      COLLECTION_QUEUE_PREFIX: 'test-' + randomUUID(),
      COLLECTION_COOLDOWN_MINUTES: 0,
    }),
    VALKEY_URL: valkey,
  };
  operationsConfig = config;
  const options = {
    connection: queueConnection(valkey, true),
    prefix: config.COLLECTION_QUEUE_PREFIX,
  };
  queues = {
    collection: new Queue('collection', options),
    embedding: new Queue('embedding', options),
    scoring: new Queue('scoring', options),
    permits: new Map(
      ['adzuna', 'greenhouse', 'lever', 'ashby'].map((id) => [
        id,
        new Queue('source-' + id, options),
      ]),
    ),
  };
  const transport: JsonTransport = async (url) => {
    requested.push(url.hostname);
    if (url.hostname === 'api.lever.co' && mode === 'failure')
      return { status: 500, value: null };
    if (url.hostname === 'api.lever.co') {
      const values = fixture('lever') as unknown as Array<
        Record<string, unknown>
      >;
      return {
        status: 200,
        value: values.map((v) => ({
          ...v,
          text: 'Example Engineer',
          categories: { location: 'Lyon', commitment: 'permanent' },
        })),
      };
    }
    const value = fixture('greenhouse') as {
      jobs: Array<Record<string, unknown>>;
    };
    return {
      status: 200,
      value: {
        jobs: value.jobs.map((v) => ({
          ...v,
          title: 'Example Engineer H/F',
          location: { name: 'Lyon' },
        })),
      },
    };
  };
  const crypto = new CryptoService({
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  const llm = new LlmService(
    new LlmRepository(db),
    crypto,
    llmEnvironmentSchema.parse({}),
    () => provider,
  );
  runtime = new CollectionRuntime(
    db,
    llm,
    crypto,
    config,
    queues,
    undefined,
    transport,
  );
  await runtime.start();
}, 120000);
beforeEach(async () => {
  await db.user.deleteMany();
  await db.jobOffer.deleteMany();
  requested.length = 0;
  mode = 'failure';
  userId = (
    await db.user.create({
      data: {
        email: 'collection@example.invalid',
        passwordHash: 'not-a-login-hash',
      },
    })
  ).id;
  otherId = (
    await db.user.create({
      data: {
        email: 'other@example.invalid',
        passwordHash: 'not-a-login-hash',
      },
    })
  ).id;
});
afterAll(async () => {
  await runtime?.close();
  if (queues)
    await Promise.all([
      queues.collection.close(),
      queues.embedding.close(),
      queues.scoring.close(),
      ...Array.from(queues.permits.values(), (q) => q.close()),
    ]);
  await db?.$disconnect();
  await vk?.stop();
  await pg?.stop();
});
async function prepare(
  id: string,
  sources = ['lever', 'greenhouse'],
  model = 'test-embedding',
) {
  await db.userSettings.create({
    data: {
      userId: id,
      llmProvider: 'ollama',
      generationModel: 'test',
      scoringModel: 'test',
      embeddingProvider: 'ollama',
      embeddingModel: model,
      ollamaBaseUrl: 'http://localhost:11434',
      collectionCooldownMin: 0,
      imap: Prisma.DbNull,
    },
  });
  const resume = await db.resume.create({
    data: {
      userId: id,
      title: 'Synthetic',
      data: { basics: { name: 'Example' } },
    },
  });
  await db.search.create({
    data: {
      userId: id,
      resumeId: resume.id,
      name: 'Example',
      titles: ['Engineer'],
      includeKeywords: [],
      excludeKeywords: [],
      locations: [],
      remote: [],
      contractTypes: [],
      sources,
    },
  });
  await db.trackedCompany.createMany({
    data: ['lever', 'greenhouse'].map((atsType) => ({
      userId: id,
      name: 'Example Company',
      atsType,
      atsToken: 'example',
    })),
  });
}
async function finish(id: string, runId: string) {
  for (let i = 0; i < 300; i++) {
    const run = await new CollectionRepository(db).get(id, runId);
    if (run && !['queued', 'running'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Collection did not finish');
}
async function launch(id: string) {
  const run = await new CollectionRepository(db).start(id, 0);
  await runtime.recover();
  return finish(id, run.id);
}
it('recovers queued runs and retains successful sources after another source fails', async () => {
  await prepare(userId);
  const result = await launch(userId);
  expect(result.status).toBe('completed_with_errors');
  expect(result.stats.new).toBe(1);
  expect(result.stats.sourcesProcessed).toBe(2);
  expect(result.stats.embeddingsReady).toBe(1);
  expect(result.errors).toContainEqual({
    source: 'lever',
    code: 'SOURCE_UNAVAILABLE',
  });
  expect(requested).toContain('boards-api.greenhouse.io');
  expect(await db.userJobMatch.count({ where: { userId } })).toBe(1);
});
it('deduplicates across sources and preserves ignored offers across runs', async () => {
  mode = 'dedup';
  await prepare(userId);
  const result = await launch(userId);
  expect(result.stats.new).toBe(1);
  expect(result.stats.duplicates).toBe(1);
  expect(await db.jobOffer.count()).toBe(1);
  expect(await db.jobOfferAlias.count()).toBe(2);
  const offer = await db.jobOffer.findFirstOrThrow();
  expect(offer.alternateUrls).toHaveLength(1);
  await db.userJobMatch.updateMany({
    where: { userId },
    data: { status: 'ignored' },
  });
  const usage = await db.llmUsage.count({ where: { userId } });
  const again = await launch(userId);
  expect(again.stats.new).toBe(0);
  expect(again.stats.duplicates).toBe(2);
  expect(
    (await db.userJobMatch.findFirstOrThrow({ where: { userId } })).status,
  ).toBe('ignored');
  expect(await db.llmUsage.count({ where: { userId } })).toBe(usage);
});
it('isolates offer embeddings by user and model while sharing normalized offers', async () => {
  mode = 'dedup';
  await prepare(userId, ['greenhouse'], 'model-a');
  await prepare(otherId, ['greenhouse'], 'model-b');
  await launch(userId);
  await launch(otherId);
  expect(await db.jobOffer.count()).toBe(1);
  const vectors = await db.offerEmbedding.findMany({
    where: { status: 'ready' },
  });
  expect(vectors).toHaveLength(2);
  expect(new Set(vectors.map((v) => v.profileKey)).size).toBe(2);
  expect(new Set(vectors.map((v) => v.userId)).size).toBe(2);
  await db.userSettings.update({
    where: { userId },
    data: { embeddingModel: 'model-c' },
  });
  const changed = await launch(userId);
  expect(changed.stats.embeddingsReady).toBe(1);
  expect(changed.stats.new).toBe(0);
  expect(
    await db.offerEmbedding.count({ where: { userId, status: 'ready' } }),
  ).toBe(2);
});
it('coalesces concurrent collection starts and fences expired worker leases', async () => {
  await prepare(userId, ['greenhouse']);
  const repository = new CollectionRepository(db);
  const [a, b] = await Promise.all([
    repository.start(userId, 0),
    repository.start(userId, 0),
  ]);
  expect(a.id).toBe(b.id);
  expect(await db.collectionRun.count({ where: { userId } })).toBe(1);
  const first = await repository.claim(userId, a.id);
  expect(first).toBeTruthy();
  await db.collectionRun.update({
    where: { id: a.id },
    data: { heartbeatAt: new Date(Date.now() - 180000) },
  });
  const second = await repository.claim(userId, a.id);
  expect(second).not.toBe(first);
  const step = await db.collectionStep.findFirstOrThrow({
    where: { runId: a.id },
  });
  const raw = (fixture('greenhouse') as { jobs: unknown[] }).jobs[0];
  const normalized = new GreenhouseSource().normalize({
    value: raw,
    company: 'Example Company',
    token: 'example',
    country: 'ZZ',
  });
  expect(
    await repository.store(userId, a.id, step.id, first!, normalized),
  ).toBeNull();
  expect(await db.collectionItem.count({ where: { userId } })).toBe(0);
  await db.collectionRun.update({
    where: { id: a.id },
    data: { status: 'failed', finishedAt: new Date() },
  });
});

it('reconciles per-user job schedulers and rejects stale or disabled schedules', async () => {
  await prepare(userId, ['greenhouse']);
  await prepare(otherId, ['greenhouse']);
  const cron = '0 0 1 1 *';
  await db.userSettings.update({
    where: { userId },
    data: { collectionCron: cron },
  });
  const ops = new OperationsRuntime(
    db,
    { ...operationsEnvironmentSchema.parse({}), ...operationsConfig },
    async () => {},
  );
  const q = new Queue('operations', {
    connection: queueConnection(operationsConfig.VALKEY_URL),
    prefix: operationsConfig.COLLECTION_QUEUE_PREFIX,
  });
  try {
    await ops.reconcile();
    await ops.reconcile();
    expect(
      (await q.getJobSchedulers())
        .filter((row) => row.key.startsWith('user-'))
        .map((row) => row.key),
    ).toEqual(['user-' + userId]);
    await ops.collect(otherId, cron);
    await ops.collect(userId, '0 1 1 1 *');
    expect(await db.collectionRun.count()).toBe(0);
    await Promise.all([ops.collect(userId, cron), ops.collect(userId, cron)]);
    expect(
      await db.collectionRun.count({ where: { userId, trigger: 'scheduled' } }),
    ).toBe(1);
    await db.userSettings.update({
      where: { userId },
      data: { collectionCron: null },
    });
    await ops.reconcile();
    expect(
      (await q.getJobSchedulers()).filter((row) => row.key.startsWith('user-')),
    ).toHaveLength(0);
    await ops.collect(userId, cron);
    expect(await db.collectionRun.count({ where: { userId } })).toBe(1);
  } finally {
    await ops.beforeApplicationShutdown();
    await q.close();
  }
});
it('purges only old untouched offers and preserves all explicit actions and active collection references', async () => {
  await prepare(userId, ['greenhouse']);
  const search = await db.search.findFirstOrThrow({ where: { userId } });
  const create = async (label: string, old = true) =>
    db.jobOffer.create({
      data: {
        sourceId: 'greenhouse',
        externalId: label,
        dedupKey: label,
        url: 'https://example.invalid/' + label,
        title: label,
        company: 'Synthetic company',
        location: { city: 'Lyon', country: 'FR' },
        remote: 'unknown',
        contractType: 'unknown',
        description: 'Synthetic',
        fetchedAt: old ? new Date('2020-01-01') : new Date(),
      },
    });
  const old = await create('untouched'),
    recent = await create('recent', false);
  for (const status of ['interesting', 'ignored', 'applied']) {
    const offer = await create(status);
    await db.userJobMatch.create({
      data: {
        userId,
        searchId: search.id,
        jobOfferId: offer.id,
        status,
        hardFilterPassed: true,
      },
    });
  }
  const draft = await create('draft');
  await db.application.create({ data: { userId, jobOfferId: draft.id } });
  const active = await create('active');
  const run = await db.collectionRun.create({
    data: { userId, trigger: 'manual' },
  });
  const step = await db.collectionStep.create({
    data: {
      userId,
      runId: run.id,
      searchId: search.id,
      source: 'greenhouse',
      criteria: {},
    },
  });
  await db.collectionItem.create({
    data: {
      userId,
      runId: run.id,
      stepId: step.id,
      externalId: 'active',
      jobOfferId: active.id,
      isNew: true,
    },
  });
  const ops = new OperationsRuntime(
    db,
    { ...operationsEnvironmentSchema.parse({}), ...operationsConfig },
    async () => {},
  );
  try {
    expect((await ops.purge()).count).toBe(1);
    expect(await db.jobOffer.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.jobOffer.count()).toBe(6);
    expect(
      await db.jobOffer.findUnique({ where: { id: recent.id } }),
    ).not.toBeNull();
    await db.collectionRun.update({
      where: { id: run.id },
      data: { status: 'completed' },
    });
    expect((await ops.purge()).count).toBe(1);
  } finally {
    await ops.beforeApplicationShutdown();
  }
});
it('reports disabled, successful and failed backups without exposing configuration', async () => {
  const client = new Redis(operationsConfig.VALKEY_URL, {
    maxRetriesPerRequest: 1,
  });
  const key = operationsConfig.COLLECTION_QUEUE_PREFIX + ':operations-status';
  const disabled = new OperationsRuntime(
    db,
    { ...operationsEnvironmentSchema.parse({}), ...operationsConfig },
    async () => {
      throw new Error('Must not run');
    },
  );
  try {
    await disabled.runBackup();
    expect(JSON.parse((await client.get(key))!).backupStatus).toBe('disabled');
  } finally {
    await disabled.beforeApplicationShutdown();
  }
  let fail = false;
  const enabled = new OperationsRuntime(
    db,
    {
      ...operationsEnvironmentSchema.parse({}),
      ...operationsConfig,
      BACKUP_S3_BUCKET: 'synthetic',
    },
    async () => {
      if (fail) throw new Error('Private details');
    },
  );
  try {
    await enabled.runBackup();
    const saved = JSON.parse((await client.get(key))!);
    expect(saved.backupStatus).toBe('succeeded');
    expect(saved.lastBackupAt).toBeTruthy();
    fail = true;
    await expect(enabled.runBackup()).rejects.toThrow(
      'Encrypted backup failed',
    );
    const failed = JSON.parse((await client.get(key))!);
    expect(failed.backupStatus).toBe('failed');
    expect(failed.lastBackupAt).toBe(saved.lastBackupAt);
    expect(JSON.stringify(failed)).not.toContain('Private details');
  } finally {
    await enabled.beforeApplicationShutdown();
    client.disconnect();
  }
});
it('executes a BullMQ Job Scheduler delivery through the real scheduled collection path', async () => {
  await prepare(userId, ['greenhouse']);
  const cron = '0 0 1 1 *';
  await db.userSettings.update({
    where: { userId },
    data: { collectionCron: cron, collectionCooldownMin: 30 },
  });
  const ops = new OperationsRuntime(
    db,
    { ...operationsEnvironmentSchema.parse({}), ...operationsConfig },
    async () => {},
  );
  const queue = new Queue('operations', {
    connection: queueConnection(operationsConfig.VALKEY_URL),
    prefix: operationsConfig.COLLECTION_QUEUE_PREFIX,
  });
  try {
    await ops.start();
    await queue.upsertJobScheduler(
      'integration-delivery',
      { every: 1000 },
      {
        name: 'scheduled-collection',
        data: { userId, cron },
        opts: { removeOnComplete: true, removeOnFail: true },
      },
    );
    await expect
      .poll(
        () =>
          db.collectionRun.count({ where: { userId, trigger: 'scheduled' } }),
        { timeout: 15000 },
      )
      .toBe(1);
    await queue.removeJobScheduler('integration-delivery');
    const run = await db.collectionRun.findFirstOrThrow({
      where: { userId, trigger: 'scheduled' },
    });
    await runtime.recover();
    const result = await finish(userId, run.id);
    expect(result.status).toBe('completed_with_errors');
    expect(result.errors).toEqual([
      { source: 'scoring', code: 'SCORING_NOT_READY' },
    ]);
    expect(result.stats.found).toBe(1);
    expect(result.stats.embeddingsReady).toBe(1);
    expect(await db.collectionRun.count({ where: { userId } })).toBe(1);
  } finally {
    await queue.removeJobScheduler('integration-delivery');
    await ops.beforeApplicationShutdown();
    await queue.close();
  }
});
