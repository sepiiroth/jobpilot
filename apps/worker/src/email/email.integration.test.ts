import { sendMailFixture } from '../testing/smtp-fixture.ts';
import { Queue } from 'bullmq';
import {
  CollectionRuntime,
  type RuntimeQueues,
} from '../collection/runtime.ts';
import { CollectionRepository } from '@jobpilot/db';
import {
  collectionEnvironmentSchema,
  queueConnection,
} from '@jobpilot/shared/collection';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { randomBytes } from 'node:crypto';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createDatabaseClient, type PrismaClient, Prisma } from '@jobpilot/db';
import { CryptoService } from '@jobpilot/shared/crypto';
import { emailEnvironmentSchema } from '@jobpilot/shared/email';
import {
  LlmService,
  LlmRepository,
  llmEnvironmentSchema,
  type LlmProvider,
} from '@jobpilot/llm';
import { connectImap, parseAlert } from '@jobpilot/sources';
import { EmailAlerts } from './email-alerts.ts';
let server: StartedTestContainer | undefined,
  pg: StartedTestContainer | undefined,
  mailpit: StartedTestContainer | undefined,
  db: PrismaClient;
let password = '',
  userId = '',
  ca = '';
const originalRoots = getCACertificates('default');
const raw = readFileSync(
  '../../packages/sources/src/email/__fixtures__/allowed.eml',
  'utf8',
);
const blocked = readFileSync(
  '../../packages/sources/src/email/__fixtures__/blocked.eml',
  'utf8',
);
let calls = 0;
let providerDelay = 0;
const provider: LlmProvider = {
  async generateStructured(_prompt, schema) {
    calls++;
    if (providerDelay)
      await new Promise((resolve) => setTimeout(resolve, providerDelay));
    expect(_prompt.version).toBe('email-alert-extraction-v1');
    expect(_prompt.user).not.toContain('recruiter@example.invalid');
    expect(_prompt.user).not.toContain('+33123456789');
    return {
      value: schema.parse({
        jobs: [
          {
            url: _prompt.user.includes('role-43')
              ? 'https://jobs.example.invalid/role-43'
              : 'https://jobs.example.invalid/role-42?utm_source=alert',
            title: _prompt.user.includes('role-43')
              ? 'TypeScript Engineer 43'
              : 'TypeScript Engineer',
            company: 'Example Company',
            location: { city: 'Lyon', country: 'FR' },
            remote: 'unknown',
            contractType: 'unknown',
            salaryMin: null,
            salaryMax: null,
            salaryCurrency: null,
            description: 'TypeScript role at Example Company.',
            publishedAt: null,
          },
        ],
      }),
      usage: { tokensIn: 50, tokensOut: 50 },
    };
  },
  async generateText() {
    throw new Error('Not used');
  },
  async embed() {
    return {
      value: [1, ...Array<number>(1023).fill(0)],
      usage: { tokensIn: 10, tokensOut: 0 },
    };
  },
};
beforeAll(async () => {
  password = randomBytes(24).toString('hex');
  server = await new GenericContainer('dovecot/dovecot:2.4.5-dev')
    .withEnvironment({ USER_PASSWORD: password })
    .withAddedCapabilities('SYS_CHROOT')
    .withCopyContentToContainer([
      {
        content:
          'ssl_server {\n cert_file = /tmp/jobpilot.crt\n key_file = /tmp/jobpilot.key\n}\n',
        target: '/etc/dovecot/conf.d/zz-jobpilot.conf',
      },
      { content: raw, target: '/tmp/allowed.eml' },
      { content: blocked, target: '/tmp/blocked.eml' },
    ])
    .withEntrypoint(['/bin/sh'])
    .withCommand([
      '-c',
      'openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/jobpilot.key -out /tmp/jobpilot.crt -days 1 -subj /CN=mail.example.test -addext subjectAltName=DNS:mail.example.test >/dev/null 2>&1\nexec /dovecot/sbin/dovecot -F',
    ])
    .withExposedPorts(31993)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  ca = (await server.exec(['cat', '/tmp/jobpilot.crt'])).output;
  for (const name of ['blocked', 'allowed']) {
    const result = await server.exec([
      '/bin/sh',
      '-c',
      `doveadm save -u inbox@example.invalid -m INBOX < /tmp/${name}.eml`,
    ]);
    if (result.exitCode !== 0)
      throw new Error('Synthetic mailbox seed failed: ' + result.output);
  }
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
  const url = `postgresql://jobpilot:${password}@${pg.getHost()}:${pg.getMappedPort(5432)}/jobpilot`;
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
  userId = (
    await db.user.create({
      data: {
        email: 'inbox@example.invalid',
        passwordHash: 'not-a-login-hash',
      },
    })
  ).id;
  mailpit = await new GenericContainer('axllent/mailpit:v1.27.10')
    .withExposedPorts(8025, 1025)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}, 120000);
afterAll(async () => {
  setDefaultCACertificates(originalRoots);
  await db?.$disconnect();
  await mailpit?.stop();
  await pg?.stop();
  await server?.stop();
});
it('requires trusted TLS and the correct hostname, then selects read-only and preserves flags', async () => {
  const settings = {
    host: 'mail.example.test',
    port: server!.getMappedPort(31993),
    username: 'inbox@example.invalid',
    password,
  };
  await expect(
    connectImap(settings, server!.getHost(), 3000, 512000),
  ).rejects.toThrow('EMAIL_CONNECTION_FAILED');
  setDefaultCACertificates([...originalRoots, ca]);
  await expect(
    connectImap(
      { ...settings, host: 'wrong.example.test' },
      server!.getHost(),
      3000,
      512000,
    ),
  ).rejects.toThrow('EMAIL_CONNECTION_FAILED');
  const before = await server!.exec([
    'doveadm',
    'fetch',
    '-u',
    'inbox@example.invalid',
    'uid flags',
    'mailbox',
    'INBOX',
  ]);
  const client = await connectImap(settings, server!.getHost(), 5000, 512000);
  try {
    const identity = await client.open('INBOX');
    expect(identity.uidNext).toBe(3);
    const rows = await client.list(1, 2);
    expect(rows).toHaveLength(2);
    const message = await client.download(2, 512000);
    expect(message).not.toBeNull();
    const parsed = await parseAlert(message!);
    expect(parsed.senders).toEqual(['alerts@example.invalid']);
    expect(parsed.links).toContain('https://jobs.example.invalid/role-42');
    await expect(client.download(2, 30)).rejects.toThrow(
      'EMAIL_MESSAGE_TOO_LARGE',
    );
  } finally {
    await client.close();
  }
  const after = await server!.exec([
    'doveadm',
    'fetch',
    '-u',
    'inbox@example.invalid',
    'uid flags',
    'mailbox',
    'INBOX',
  ]);
  expect(after.output).toBe(before.output);
  expect(after.output).not.toContain('\\Seen');
});
it('ignores the blocked sender, extracts the authorized UID once and reuses its private cache', async () => {
  setDefaultCACertificates([...originalRoots, ca]);
  calls = 0;
  const crypto = new CryptoService({
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  await db.userSettings.create({
    data: {
      userId,
      llmProvider: 'ollama',
      generationModel: 'test',
      scoringModel: 'test',
      embeddingProvider: 'ollama',
      embeddingModel: 'test',
      ollamaBaseUrl: 'http://localhost:11434',
      imap: {
        host: 'mail.example.test',
        port: server!.getMappedPort(31993),
        username: 'inbox@example.invalid',
        mailbox: 'INBOX',
        allowedSenders: ['alerts@example.invalid'],
      } as Prisma.InputJsonValue,
    },
  });
  const secret = crypto.encrypt(password, `${userId}:imap`);
  await db.userSecret.create({
    data: {
      userId,
      kind: 'imap',
      ...secret,
      ciphertext: new Uint8Array(secret.ciphertext),
      iv: new Uint8Array(secret.iv),
      authTag: new Uint8Array(secret.authTag),
    },
  });
  const llm = new LlmService(
    new LlmRepository(db),
    crypto,
    llmEnvironmentSchema.parse({ LLM_MAX_RETRIES: 2 }),
    () => provider,
  );
  const alerts = new EmailAlerts(
    db,
    llm,
    crypto,
    emailEnvironmentSchema.parse({ ALLOW_PRIVATE_IMAP_HOST: 'true' }),
    connectImap,
    async () => [
      {
        address:
          server!.getHost() === 'localhost' ? '127.0.0.1' : server!.getHost(),
        family: 4,
      },
    ],
  );
  expect(await alerts.configured(userId)).toBe(true);
  const first = await alerts.collect(
    userId,
    async () => {},
    Date.now() + 30000,
  );
  expect(first.offers).toHaveLength(1);
  expect(first.offers[0]!.url).toBe('https://jobs.example.invalid/role-42');
  expect(calls).toBe(1);
  const second = await alerts.collect(
    userId,
    async () => {},
    Date.now() + 30000,
  );
  expect(second.offers).toEqual(first.offers);
  expect(calls).toBe(1);
  expect(
    await db.emailMessage.count({
      where: { userId, status: 'ignored', errorCode: 'EMAIL_SENDER_BLOCKED' },
    }),
  ).toBe(1);
  expect(
    await db.emailMessage.count({ where: { userId, status: 'completed' } }),
  ).toBe(1);
  expect(
    (await db.emailMailbox.findFirstOrThrow({ where: { userId } })).lastUid,
  ).toBe('2');
  expect(
    await db.llmUsage.count({ where: { userId, purpose: 'email_extraction' } }),
  ).toBe(1);
});
it('submits the same anonymized MIME fixture to Mailpit for local inspection', async () => {
  const base = `http://${mailpit!.getHost()}:${mailpit!.getMappedPort(8025)}`;
  await sendMailFixture(mailpit!.getHost(), mailpit!.getMappedPort(1025), raw);
  const messages = (await fetch(base + '/api/v1/messages').then((r) =>
    r.json(),
  )) as { total: number; messages: Array<{ ID: string }> };
  expect(messages.total).toBe(1);
  const stored = await fetch(
    base + '/api/v1/message/' + messages.messages[0]!.ID + '/raw',
  );
  expect(stored.ok).toBe(true);
  expect(await stored.text()).toContain('synthetic-alert-1@example.invalid');
});
it('collects one mailbox for two active searches through the real BullMQ pipeline', async () => {
  setDefaultCACertificates([...originalRoots, ca]);
  calls = 0;
  providerDelay = 2000;
  await server!.copyContentToContainer([
    {
      content: raw
        .replaceAll('role-42', 'role-43')
        .replaceAll('synthetic-alert-1', 'synthetic-alert-2'),
      target: '/tmp/extra.eml',
    },
  ]);
  const added = await server!.exec([
    '/bin/sh',
    '-c',
    `doveadm save -u pipeline-inbox@example.invalid -m INBOX < /tmp/blocked.eml
doveadm save -u pipeline-inbox@example.invalid -m INBOX < /tmp/allowed.eml
doveadm save -u pipeline-inbox@example.invalid -m INBOX < /tmp/extra.eml`,
  ]);
  expect(added.exitCode).toBe(0);
  const pipelineUser = (
    await db.user.create({
      data: {
        email: 'pipeline@example.invalid',
        passwordHash: 'not-a-login-hash',
      },
    })
  ).id;
  const configCrypto = new CryptoService({
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  await db.userSettings.create({
    data: {
      userId: pipelineUser,
      llmProvider: 'ollama',
      generationModel: 'test',
      scoringModel: 'test',
      embeddingProvider: 'ollama',
      embeddingModel: 'test',
      ollamaBaseUrl: 'http://localhost:11434',
      collectionCooldownMin: 0,
      imap: {
        host: 'mail.example.test',
        port: server!.getMappedPort(31993),
        username: 'pipeline-inbox@example.invalid',
        mailbox: 'INBOX',
        allowedSenders: ['alerts@example.invalid'],
      },
    },
  });
  const secret = configCrypto.encrypt(password, pipelineUser + ':imap');
  await db.userSecret.create({
    data: {
      userId: pipelineUser,
      kind: 'imap',
      ...secret,
      ciphertext: new Uint8Array(secret.ciphertext),
      iv: new Uint8Array(secret.iv),
      authTag: new Uint8Array(secret.authTag),
    },
  });
  const copy = await db.resume.create({
    data: {
      userId: pipelineUser,
      title: 'Synthetic',
      data: { basics: { name: 'Synthetic Example' } },
    },
  });
  for (let i = 0; i < 2; i++)
    await db.search.create({
      data: {
        userId: pipelineUser,
        resumeId: copy.id,
        name: 'Email search ' + i,
        titles: ['TypeScript'],
        includeKeywords: [],
        excludeKeywords: [],
        locations: [],
        remote: [],
        contractTypes: [],
        sources: ['email'],
      },
    });
  let valkey: StartedTestContainer | undefined,
    runtime: CollectionRuntime | undefined,
    queues: RuntimeQueues | undefined;
  try {
    valkey = await new GenericContainer('valkey/valkey:8-alpine')
      .withCommand(['valkey-server', '--requirepass', password])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start();
    const url = `redis://:${password}@${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
    const config = {
      ...collectionEnvironmentSchema.parse({
        COLLECTION_QUEUE_PREFIX: 'email-test-' + randomUUID(),
      }),
      ...emailEnvironmentSchema.parse({
        ALLOW_PRIVATE_IMAP_HOST: 'true',
        EMAIL_ALERT_TIMEOUT_MS: 1500,
      }),
      VALKEY_URL: url,
      SCORING_LLM_TOP_N: 0,
    };
    const queue = (name: string) =>
      new Queue(name, {
        connection: queueConnection(url, true),
        prefix: config.COLLECTION_QUEUE_PREFIX,
      });
    queues = {
      collection: queue('collection'),
      embedding: queue('embedding'),
      scoring: queue('scoring'),
      permits: new Map(
        ['adzuna', 'greenhouse', 'lever', 'ashby', 'email'].map((s) => [
          s,
          queue('source-' + s),
        ]),
      ),
    };
    const llm = new LlmService(
      new LlmRepository(db),
      configCrypto,
      llmEnvironmentSchema.parse({}),
      () => provider,
    );
    const collection = await new CollectionRepository(db).start(
      pipelineUser,
      0,
    );
    runtime = new CollectionRuntime(
      db,
      llm,
      configCrypto,
      config,
      queues,
      undefined,
      undefined,
      async () => [
        {
          address:
            server!.getHost() === 'localhost' ? '127.0.0.1' : server!.getHost(),
          family: 4,
        },
      ],
    );
    await runtime.start();
    for (let attempt = 0; attempt < 1200; attempt++) {
      const current = await db.collectionRun.findUniqueOrThrow({
        where: { id: collection.id },
      });
      if (!['queued', 'running'].includes(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const result = await new CollectionRepository(db).get(
      pipelineUser,
      collection.id,
    );
    expect(result?.status).toBe('completed_with_errors');
    expect(result?.errors).toEqual([
      { source: 'scoring', code: 'SCORING_NOT_READY' },
      { source: 'scoring', code: 'SCORING_NOT_READY' },
    ]);
    expect(result?.stats.sourcesProcessed).toBe(2);
    expect(result?.stats.found).toBe(4);
    expect(result?.stats.new).toBe(2);
    expect(result?.stats.embeddingsReady).toBe(2);
    expect(calls).toBe(2);
    expect(
      await db.emailMessage.count({
        where: { userId: pipelineUser, status: 'completed' },
      }),
    ).toBe(2);
    expect(
      await db.jobOffer.count({ where: { privateUserId: pipelineUser } }),
    ).toBe(2);
    expect(
      await db.searchMatch.count({
        where: { userId: pipelineUser, passed: true },
      }),
    ).toBe(4);
  } finally {
    providerDelay = 0;
    await runtime?.close();
    if (queues)
      await Promise.all([
        queues.collection.close(),
        queues.embedding.close(),
        queues.scoring.close(),
        ...Array.from(queues.permits.values(), (q) => q.close()),
      ]);
    await valkey?.stop();
  }
}, 180000);
