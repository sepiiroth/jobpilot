import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import {
  createDatabaseClient,
  EmailRepository,
  emailAccountKey,
  type PrismaClient,
} from '@jobpilot/db';
import { CryptoService } from '@jobpilot/shared/crypto';
import {
  emailEnvironmentSchema,
  type EmailEnvironment,
} from '@jobpilot/shared/email';
import {
  LlmService,
  LlmRepository,
  LlmError,
  llmEnvironmentSchema,
  type LlmProvider,
} from '@jobpilot/llm';
import {
  SourceError,
  type EmailConnection,
  type EmailMetadata,
} from '@jobpilot/sources';
import { EmailAlerts } from '../../../worker/src/email/email-alerts.ts';
let pg: StartedTestContainer | undefined,
  db: PrismaClient,
  userId = '';
const raw = Buffer.from(
  readFileSync(
    '../../packages/sources/src/email/__fixtures__/allowed.eml',
    'utf8',
  ),
);
const blocked = Buffer.from(
  readFileSync(
    '../../packages/sources/src/email/__fixtures__/blocked.eml',
    'utf8',
  ),
);
beforeAll(async () => {
  const password = randomBytes(24).toString('hex');
  pg = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
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
  const url = `postgresql://jobpilot:${password}@${pg.getHost() === 'localhost' ? '127.0.0.1' : pg.getHost()}:${pg.getMappedPort(5432)}/jobpilot`;
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
});
beforeEach(async () => {
  await db.user.deleteMany();
  userId = (
    await db.user.create({
      data: {
        email: 'synthetic@example.invalid',
        passwordHash: 'not-a-login-hash',
      },
    })
  ).id;
});
afterAll(async () => {
  await db?.$disconnect();
  await pg?.stop();
});
async function fixture(
  options: {
    count?: number;
    config?: Record<string, string | number>;
    localSenders?: string[];
    noSecret?: boolean;
  } = {},
) {
  const cfg: EmailEnvironment = emailEnvironmentSchema.parse({
    ALLOW_PRIVATE_IMAP_HOST: 'true',
    ...options.config,
  });
  const crypto = new CryptoService({
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      ENCRYPTION_KEY_VERSION: 1,
      ENCRYPTION_PREVIOUS_KEYS: {},
    }),
    password = randomBytes(24).toString('hex');
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
        host: 'mail.example.invalid',
        port: 993,
        username: 'synthetic@example.invalid',
        mailbox: 'INBOX',
        allowedSenders: options.localSenders ?? ['alerts@example.invalid'],
      },
    },
  });
  if (!options.noSecret) {
    const encrypted = crypto.encrypt(password, userId + ':imap');
    await db.userSecret.create({
      data: {
        userId,
        kind: 'imap',
        ...encrypted,
        ciphertext: new Uint8Array(encrypted.ciphertext),
        iv: new Uint8Array(encrypted.iv),
        authTag: new Uint8Array(encrypted.authTag),
      },
    });
  }
  const state = {
    calls: 0,
    downloads: 0,
    connections: 0,
    closed: 0,
    permits: 0,
    failure: false,
    ungrounded: false,
    openFailure: false,
    downloadError: false,
    nullBody: false,
    body: raw,
    metadata: Array.from({ length: options.count ?? 1 }, (_, i) => ({
      uid: i + 1,
      size: raw.length,
      senders: ['alerts@example.invalid'],
    })) as EmailMetadata[],
  };
  const connection: EmailConnection = {
    async open() {
      if (state.openFailure) throw new SourceError('EMAIL_INVALID_MAILBOX');
      return { uidValidity: '42', uidNext: (options.count ?? 1) + 1 };
    },
    async list(lower, upper) {
      return state.metadata.filter((m) => m.uid >= lower && m.uid <= upper);
    },
    async download(uid) {
      state.downloads++;
      if (state.downloadError && uid === 2)
        throw new Error('Sensitive protocol failure');
      if (state.nullBody) return null;
      return state.body;
    },
    async close() {
      state.closed++;
    },
  };
  const provider: LlmProvider = {
    async generateStructured(_prompt, schema) {
      state.calls++;
      if (state.failure) throw new LlmError('LLM_UNAVAILABLE', true);
      return {
        value: schema.parse({
          jobs: [
            {
              url: state.ungrounded
                ? 'https://invented.example.invalid/job'
                : 'https://jobs.example.invalid/role-42',
              title: 'TypeScript Engineer',
              company: 'Example Company',
              location: { city: 'Lyon', country: 'FR' },
              remote: 'unknown',
              contractType: 'unknown',
              salaryMin: null,
              salaryMax: null,
              salaryCurrency: null,
              description: 'Synthetic vacancy',
              publishedAt: null,
            },
          ],
        }),
        usage: { tokensIn: 10, tokensOut: 10 },
      };
    },
    async generateText() {
      throw Error('Not used');
    },
    async embed() {
      throw Error('Not used');
    },
  };
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
    cfg,
    async (settings) => {
      state.connections++;
      expect(settings.password).toBe(password);
      return connection;
    },
    async () => [{ address: '127.0.0.1', family: 4 }],
  );
  const collect = (deadline = Date.now() + 30000) =>
    alerts.collect(
      userId,
      async () => {
        state.permits++;
      },
      deadline,
    );
  return { alerts, state, collect, cfg };
}
it('requires mailbox settings, a secret and an effective sender allowlist before connecting', async () => {
  const crypto = new CryptoService({
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  const llm = new LlmService(
    new LlmRepository(db),
    crypto,
    llmEnvironmentSchema.parse({}),
    () => {
      throw Error('Not used');
    },
  );
  const empty = new EmailAlerts(db, llm, crypto);
  expect(await empty.configured(userId)).toBe(false);
  await expect(
    empty.collect(userId, async () => {}, Date.now() + 1000),
  ).rejects.toThrow('SOURCE_NOT_CONFIGURED');
  const { alerts, state, collect } = await fixture({ noSecret: true });
  expect(await alerts.configured(userId)).toBe(false);
  await expect(collect()).rejects.toThrow('SOURCE_NOT_CONFIGURED');
  expect(state.connections).toBe(0);
});
it('enforces global restrictions and refuses private DNS answers unless enabled', async () => {
  const { alerts, collect, state } = await fixture({
    config: { EMAIL_ALERT_ALLOWED_SENDERS: 'other@example.invalid' },
  });
  expect(await alerts.configured(userId)).toBe(false);
  await expect(collect()).rejects.toThrow('SOURCE_NOT_CONFIGURED');
  expect(state.connections).toBe(0);
});
it('accepts administrator defaults and does not re-extract completed messages', async () => {
  const { alerts, collect, state } = await fixture({
    localSenders: [],
    config: { EMAIL_ALERT_ALLOWED_SENDERS: 'alerts@example.invalid' },
  });
  expect(await alerts.configured(userId)).toBe(true);
  const first = await collect();
  expect(first.offers).toHaveLength(1);
  expect(first.warning).toBeUndefined();
  expect((await collect()).offers).toEqual(first.offers);
  expect(state.calls).toBe(1);
  expect(state.downloads).toBe(1);
  expect(state.closed).toBe(2);
});
it('blocks DNS private addresses before decrypting or sending credentials to a server', async () => {
  const { collect, state } = await fixture({
    config: { ALLOW_PRIVATE_IMAP_HOST: 'false' },
  });
  await expect(collect()).rejects.toThrow('EMAIL_HOST_FORBIDDEN');
  expect(state.connections).toBe(0);
});
it('skips unauthorized, ambiguous and oversized envelopes without downloading bodies', async () => {
  const { collect, state } = await fixture({ count: 3 });
  state.metadata = [
    { uid: 1, size: raw.length, senders: ['blocked@example.invalid'] },
    {
      uid: 2,
      size: raw.length,
      senders: ['alerts@example.invalid', 'other@example.invalid'],
    },
    { uid: 3, size: 3000000, senders: ['alerts@example.invalid'] },
  ];
  const result = await collect();
  expect(result.warning).toBe('EMAIL_MESSAGE_TOO_LARGE');
  expect(result.offers).toHaveLength(0);
  expect(state.calls).toBe(0);
  expect(state.downloads).toBe(0);
});
it('checks the MIME From header independently from the envelope', async () => {
  const { collect, state } = await fixture();
  state.body = blocked;
  expect((await collect()).offers).toHaveLength(0);
  expect(state.calls).toBe(0);
  expect(
    await db.emailMessage.count({
      where: { userId, errorCode: 'EMAIL_SENDER_BLOCKED' },
    }),
  ).toBe(1);
});
it('consumes failed or ungrounded extractions once without automatic retries', async () => {
  const { collect, state } = await fixture();
  state.failure = true;
  expect((await collect()).warning).toBe('EMAIL_EXTRACTION_FAILED');
  state.failure = false;
  expect((await collect()).warning).toBe('EMAIL_EXTRACTION_UNCERTAIN');
  expect(state.calls).toBe(1);
});
it('rejects invented URLs even when their structured output is valid', async () => {
  const { collect, state } = await fixture();
  state.ungrounded = true;
  const result = await collect();
  expect(result.offers).toHaveLength(0);
  expect(result.warning).toBe('EMAIL_EXTRACTION_FAILED');
  expect(
    (await db.emailMessage.findFirstOrThrow({ where: { userId } })).offers,
  ).toEqual([]);
});
it('keeps a persisted in-progress UID uncertain instead of calling the provider again', async () => {
  const { collect, state } = await fixture();
  await new EmailRepository(db).claim(
    userId,
    emailAccountKey(
      'mail.example.invalid',
      993,
      'synthetic@example.invalid',
      'INBOX',
    ),
    '42',
    '1',
    'processing',
    null,
    createHash('sha256').update('alerts@example.invalid').digest('hex'),
  );
  expect((await collect()).warning).toBe('EMAIL_EXTRACTION_UNCERTAIN');
  expect(state.calls).toBe(0);
  expect(state.downloads).toBe(0);
});
it('bounds each UID window and exposes cache truncation', async () => {
  const { collect, state } = await fixture({
    count: 2,
    config: { EMAIL_ALERT_MAX_MESSAGES: 1, EMAIL_ALERT_CACHE_MESSAGES: 1 },
  });
  expect((await collect()).warning).toBe('EMAIL_MESSAGE_LIMIT');
  const second = await collect();
  expect(second.offers).toHaveLength(1);
  expect(second.warning).toBe('EMAIL_CACHE_LIMIT');
  expect(state.calls).toBe(2);
});
it('preserves completed receipts after a transport failure and resumes the unfinished UID', async () => {
  const { collect, state } = await fixture({ count: 2 });
  state.downloadError = true;
  const result = await collect();
  expect(result.offers).toHaveLength(1);
  expect(result.warning).toBe('EMAIL_MESSAGE_FAILED');
  state.downloadError = false;
  expect((await collect()).offers).toHaveLength(2);
  expect(state.calls).toBe(2);
});
it('stops at the collection deadline without advancing past unprocessed UIDs', async () => {
  const { collect, state } = await fixture();
  expect((await collect(Date.now() - 1)).warning).toBe('COLLECTION_TIME_LIMIT');
  expect(state.calls).toBe(0);
  expect(
    (await db.emailMailbox.findFirstOrThrow({ where: { userId } })).lastUid,
  ).toBe('0');
});
it('handles removed messages and closes invalid mailboxes safely', async () => {
  const { collect, state } = await fixture();
  state.openFailure = true;
  await expect(collect()).rejects.toThrow('EMAIL_INVALID_MAILBOX');
  expect(state.closed).toBe(1);
  state.openFailure = false;
  state.nullBody = true;
  expect((await collect()).offers).toHaveLength(0);
  expect(state.calls).toBe(0);
  expect(
    (await db.emailMessage.findFirstOrThrow({ where: { userId } })).errorCode,
  ).toBe('EMAIL_MESSAGE_REMOVED');
});
it('stores empty newsletters without invoking AI when no vacancy link is available', async () => {
  const { collect, state } = await fixture();
  state.body = Buffer.from(
    'From: alerts@example.invalid\r\nContent-Type: text/plain\r\n\r\nNo vacancy links.',
  );
  expect((await collect()).offers).toHaveLength(0);
  expect(state.calls).toBe(0);
  expect(
    (await db.emailMessage.findFirstOrThrow({ where: { userId } })).status,
  ).toBe('completed');
});
