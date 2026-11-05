import type { z } from 'zod';
import {
  LlmService,
  LlmRepository,
  LlmError,
  llmEnvironmentSchema,
  type ProviderConfiguration,
  type LlmProvider,
  type Prompt,
} from '@jobpilot/llm';
import { syntheticResume } from '../resumes/__fixtures__/resume.ts';
import { renderResumePdf } from '../resumes/resume-pdf.ts';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import request from 'supertest';
import { Redis } from 'ioredis';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { Prisma, createDatabaseClient, type PrismaClient } from '@jobpilot/db';
import { createApplication } from '../application.ts';
import { Passwords } from './passwords.ts';
import { expectOwnershipIsolation } from '../testing/idor.ts';
let postgres: StartedTestContainer | undefined,
  valkey: StartedTestContainer | undefined,
  db: PrismaClient,
  redis: Redis,
  app: NestExpressApplication,
  server: Server;
let email: string, password: string, userId: string, otherId: string;
let databaseUrl = '';
let logs = '';
const llmSelections: ProviderConfiguration[] = [];
const llmFactory = (selected: ProviderConfiguration): LlmProvider => {
  llmSelections.push({ ...selected, apiKey: 'redacted' });
  return {
    async generateStructured<T>(_prompt: Prompt, schema: z.ZodType<T>) {
      if (selected.model === 'test-invalid')
        throw new LlmError('LLM_INVALID_OUTPUT');
      return {
        value: schema.parse({ data: syntheticResume, warnings: [] }) as T,
        usage: { tokensIn: 40, tokensOut: 20 },
      };
    },
    async generateText() {
      return {
        value: 'Synthetic text',
        usage: { tokensIn: 20, tokensOut: 10 },
      };
    },
    async embed() {
      if (selected.model === 'test-failed')
        throw new LlmError('LLM_UNAVAILABLE');
      return {
        value: [1, ...Array<number>(1023).fill(0)],
        usage: { tokensIn: 10, tokensOut: 0 },
      };
    },
  };
};
const origin = 'https://web.example.invalid';
const passwords = new Passwords();
interface Browser {
  cookie: string;
  csrf: string;
}
function cookieHeader(response: request.Response): string {
  const values = response.headers['set-cookie'] as string[] | undefined;
  return (values ?? []).map((v) => v.split(';')[0]).join('; ');
}
async function csrf(): Promise<Browser> {
  const response = await request(server).get('/auth/csrf').expect(200);
  return {
    cookie: cookieHeader(response),
    csrf: String(response.body.csrfToken),
  };
}
async function login(): Promise<Browser> {
  const guest = await csrf();
  const response = await request(server)
    .post('/auth/login')
    .set('Cookie', guest.cookie)
    .set('X-CSRF-Token', guest.csrf)
    .set('Origin', origin)
    .send({ email, password })
    .expect(200);
  return {
    cookie: cookieHeader(response),
    csrf: String(response.body.csrfToken),
  };
}
beforeAll(async () => {
  const infrastructurePassword = randomBytes(24).toString('hex');
  postgres = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
    .withEnvironment({
      POSTGRES_USER: 'jobpilot',
      POSTGRES_DB: 'jobpilot',
      POSTGRES_PASSWORD: infrastructurePassword,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections', 2),
    )
    .start();
  valkey = await new GenericContainer('valkey/valkey:8-alpine')
    .withCommand(['valkey-server', '--requirepass', infrastructurePassword])
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  const url = `postgresql://jobpilot:${infrastructurePassword}@${postgres.getHost()}:${postgres.getMappedPort(5432)}/jobpilot`;
  databaseUrl = url;
  const valkeyUrl = `redis://:${infrastructurePassword}@${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
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
  redis = new Redis(valkeyUrl);
  await passwords.initialize();
  app = await createApplication(
    {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      VALKEY_URL: valkeyUrl,
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      SESSION_SECRET: randomBytes(32).toString('base64'),
      WEB_ORIGIN: origin,
      LOG_LEVEL: 'info',
    },
    {
      db,
      redis,
      llmFactory,
      logs: {
        write(chunk: string) {
          logs += chunk;
        },
      },
    },
  );
  server = app.getHttpServer() as Server;
}, 120000);
beforeEach(async () => {
  await redis.flushdb();
  await db.user.deleteMany();
  password = randomBytes(24).toString('base64url');
  email = randomBytes(8).toString('hex') + '@example.invalid';
  const user = await db.user.create({
    data: { email, passwordHash: await passwords.hash(password) },
  });
  userId = user.id;
  otherId = (
    await db.user.create({
      data: {
        email: 'other@example.invalid',
        passwordHash: await passwords.hash(randomBytes(24).toString('hex')),
      },
    })
  ).id;
});
afterAll(async () => {
  await app?.close();
  redis?.disconnect();
  await db?.$disconnect();
  await valkey?.stop();
  await postgres?.stop();
});
it('issues secure cookies, stores only a hash, and renews the session', async () => {
  const browser = await login();
  const session = await db.session.findFirstOrThrow({ where: { userId } });
  const token = browser.cookie.match(/jobpilot_session=([^;]+)/)?.[1];
  expect(token).toBeDefined();
  expect(session.tokenHash).toBe(
    createHash('sha256')
      .update(token ?? '')
      .digest('hex'),
  );
  const response = await request(server)
    .get('/auth/me')
    .set('Cookie', browser.cookie)
    .expect(200);
  expect(response.body.id).toBe(userId);
  expect(response.body.passwordHash).toBeUndefined();
  expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
  expect(String(response.headers['set-cookie'])).toContain('Secure');
  expect(String(response.headers['set-cookie'])).toContain('SameSite=Lax');
  expect(response.headers['cache-control']).toBe('no-store');
});
it('rejects wrong and unknown-user passwords and blocks the sixth attempt', async () => {
  const browser = await csrf();
  for (let i = 0; i < 6; i++) {
    await request(server)
      .post('/auth/login')
      .set('Cookie', browser.cookie)
      .set('X-CSRF-Token', browser.csrf)
      .send({ email, password: randomBytes(16).toString('hex') })
      .expect(i < 5 ? 401 : 429);
  }
  await request(server)
    .post('/auth/login')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .send({ email: 'missing@example.invalid', password })
    .expect(401);
});
it('rejects missing, malformed, expired and absolutely expired sessions', async () => {
  await request(server).get('/auth/me').expect(401);
  await request(server)
    .get('/auth/me')
    .set('Cookie', 'jobpilot_session=invalid')
    .expect(401);
  const browser = await login();
  await db.session.updateMany({
    where: { userId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await request(server)
    .get('/auth/me')
    .set('Cookie', browser.cookie)
    .expect(401);
  const next = await login();
  await db.session.updateMany({
    where: { userId },
    data: { createdAt: new Date(Date.now() - 31 * 86400000) },
  });
  await request(server).get('/auth/me').set('Cookie', next.cookie).expect(401);
});
it('rejects missing, tampered, foreign-origin and session-mismatched CSRF tokens', async () => {
  const browser = await login();
  await request(server)
    .post('/auth/logout')
    .set('Cookie', browser.cookie)
    .expect(403);
  await request(server)
    .post('/auth/logout')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf + 'x')
    .expect(403);
  await request(server)
    .post('/auth/logout')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .set('Origin', 'https://foreign.example.invalid')
    .expect(403);
  const forged = randomBytes(32).toString('hex');
  await request(server)
    .post('/auth/logout')
    .set('Cookie', 'jobpilot_csrf=' + forged)
    .set('X-CSRF-Token', forged)
    .expect(403);
  const signature =
    randomBytes(32).toString('hex') + '.' + randomBytes(32).toString('hex');
  await request(server)
    .post('/auth/logout')
    .set('Cookie', 'jobpilot_csrf=' + signature)
    .set('X-CSRF-Token', signature)
    .expect(403);
});
it('revokes one session and then all sessions', async () => {
  const first = await login(),
    second = await login();
  await request(server)
    .post('/auth/logout')
    .set('Cookie', first.cookie)
    .set('X-CSRF-Token', first.csrf)
    .expect(200);
  await request(server).get('/auth/me').set('Cookie', first.cookie).expect(401);
  await request(server)
    .get('/auth/me')
    .set('Cookie', second.cookie)
    .expect(200);
  await request(server)
    .post('/auth/logout-all')
    .set('Cookie', second.cookie)
    .set('X-CSRF-Token', second.csrf)
    .expect(200);
  expect(await db.session.count()).toBe(0);
});
it('changes passwords and revokes every existing session', async () => {
  const browser = await login();
  await request(server)
    .post('/auth/password')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .send({ currentPassword: 'incorrect', newPassword: password })
    .expect(401);
  await request(server)
    .post('/auth/password')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .send({ currentPassword: password, newPassword: 'short' })
    .expect(400);
  const next = randomBytes(24).toString('hex');
  await request(server)
    .post('/auth/password')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .send({ currentPassword: password, newPassword: next })
    .expect(200);
  expect(await db.session.count()).toBe(0);
  password = next;
  await login();
});
it('exports only the current user and deletes their data', async () => {
  await db.resume.create({
    data: { userId: otherId, title: 'Other private resume', data: {} },
  });
  await db.resume.create({ data: { userId, title: 'Own resume', data: {} } });
  const browser = await login();
  const load = async () => {
    const response = await request(server)
      .get('/users/me/export')
      .set('Cookie', browser.cookie)
      .expect(200);
    return response.body as unknown;
  };
  await expectOwnershipIsolation(load, otherId);
  const exported = JSON.stringify(await load());
  expect(exported).not.toContain('passwordHash');
  expect(exported).not.toContain('tokenHash');
  await request(server)
    .delete('/users/me')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .send({ password: 'incorrect' })
    .expect(401);
  await request(server)
    .delete('/users/me')
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .send({ password })
    .expect(200);
  expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
  expect(await db.resume.count({ where: { userId } })).toBe(0);
  expect(await db.user.findUnique({ where: { id: otherId } })).not.toBeNull();
});
it('checks both services, applies headers and keeps documentation private', async () => {
  const response = await request(server).get('/health').expect(200);
  expect(response.body.status).toBe('ok');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  await request(server).get('/docs').expect(404);
});
it('keeps passwords, tokens, hashes and request content out of logs', async () => {
  const browser = await login();
  const record = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await request(server)
    .get('/auth/me?private=' + password)
    .set('Cookie', browser.cookie)
    .set('Authorization', 'Bearer ' + password)
    .expect(200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(logs).not.toContain(password);
  expect(logs).not.toContain(record.passwordHash);
  expect(logs).not.toContain(browser.csrf);
  const token = browser.cookie.match(/jobpilot_session=([^;]+)/)?.[1];
  if (token) expect(logs).not.toContain(token);
  expect(logs).toContain('/auth/me');
});

it('creates accounts and resets passwords through the CLI', async () => {
  const cliEmail = randomBytes(8).toString('hex') + '@example.invalid';
  const cliPassword = randomBytes(24).toString('hex');
  const run = (command: string, value = cliPassword) =>
    execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', command], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        CLI_USER_EMAIL: cliEmail,
        CLI_USER_PASSWORD: value,
      },
      stdio: 'pipe',
    }).toString();
  expect(run('user:create')).toContain('User created');
  const user = await db.user.findUniqueOrThrow({ where: { email: cliEmail } });
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const changed = randomBytes(24).toString('hex');
  expect(run('user:reset-password', changed)).toContain('all sessions revoked');
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await passwords.verify(updated.passwordHash, changed)).toBe(true);
  expect(() => run('invalid')).toThrow();
});

async function browserAs(id: string): Promise<Browser> {
  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId: id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  const cookie = 'jobpilot_session=' + token;
  const response = await request(server)
    .get('/auth/csrf')
    .set('Cookie', cookie)
    .expect(200);
  return {
    cookie: cookie + '; ' + cookieHeader(response),
    csrf: String(response.body.csrfToken),
  };
}
function profileWrite(
  browser: Browser,
  path: string,
  value: object,
  method: 'post' | 'delete' = 'post',
) {
  return request(server)
    [method](path)
    .set('Cookie', browser.cookie)
    .set('X-CSRF-Token', browser.csrf)
    .set('Origin', origin)
    .send(value);
}
const resumeInput = {
  title: 'Synthetic test CV',
  data: {
    basics: {
      name: 'Camille Exemple',
      summary: 'Développement logiciel et qualité',
    },
    work: [],
    education: [],
    skills: [{ name: 'TypeScript', keywords: ['Tests'] }],
    languages: [],
    projects: [],
  },
  isArchived: false,
};
it('isolates resume CRUD and PDF exports between owners', async () => {
  const owner = await browserAs(userId),
    stranger = await browserAs(otherId);
  const created = await profileWrite(owner, '/resumes', {
    ...resumeInput,
    userId: otherId,
  }).expect(400);
  expect(created.body.error.code).toBe('INVALID_REQUEST');
  const saved = await profileWrite(owner, '/resumes', resumeInput).expect(200);
  const id = String(saved.body.id);
  await expectOwnershipIsolation(
    async () =>
      (
        await request(server)
          .get('/resumes')
          .set('Cookie', stranger.cookie)
          .expect(200)
      ).body as unknown,
    id,
  );
  for (const path of [`/resumes/${id}`, `/resumes/${id}/pdf`])
    await request(server).get(path).set('Cookie', stranger.cookie).expect(404);
  await profileWrite(stranger, `/resumes/${id}`, {
    ...resumeInput,
    title: 'Stolen',
  }).expect(404);
  await profileWrite(stranger, `/resumes/${id}`, {}, 'delete').expect(404);
  await profileWrite(owner, `/resumes/${id}`, {
    ...resumeInput,
    title: 'Updated CV',
  }).expect(200);
  expect(
    (await db.resume.findFirstOrThrow({ where: { id, userId } })).title,
  ).toBe('Updated CV');
  const pdf = await request(server)
    .get(`/resumes/${id}/pdf`)
    .set('Cookie', owner.cookie)
    .expect(200);
  expect(pdf.headers['content-type']).toContain('application/pdf');
  expect(pdf.headers['cache-control']).toBe('no-store');
  await profileWrite(owner, `/resumes/${id}`, {}, 'delete').expect(200);
});
it('isolates searches and rejects another owner’s resume association', async () => {
  const owner = await browserAs(userId),
    stranger = await browserAs(otherId);
  const resume = await profileWrite(owner, '/resumes', resumeInput).expect(200);
  const data = {
    name: 'Development',
    resumeId: String(resume.body.id),
    titles: ['Developer'],
    remote: ['hybrid'],
    contractTypes: ['permanent'],
    locations: [{ city: 'Lyon', country: 'FR' }],
    sources: ['adzuna'],
    salaryMin: 42000,
  };
  await profileWrite(stranger, '/searches', data).expect(404);
  const saved = await profileWrite(owner, '/searches', data).expect(200);
  const id = String(saved.body.id);
  expect(saved.body.salaryMin).toBe(42000);
  await expectOwnershipIsolation(
    async () =>
      (
        await request(server)
          .get('/searches')
          .set('Cookie', stranger.cookie)
          .expect(200)
      ).body as unknown,
    id,
  );
  await request(server)
    .get(`/searches/${id}`)
    .set('Cookie', stranger.cookie)
    .expect(404);
  await profileWrite(stranger, `/searches/${id}`, data).expect(404);
  await profileWrite(stranger, `/searches/${id}`, {}, 'delete').expect(404);
  await profileWrite(owner, `/resumes/${data.resumeId}`, {}, 'delete').expect(
    409,
  );
  await profileWrite(owner, `/searches/${id}`, {
    ...data,
    isActive: false,
  }).expect(200);
  expect(
    (await db.search.findFirstOrThrow({ where: { id, userId } })).isActive,
  ).toBe(false);
  await profileWrite(owner, `/searches/${id}`, {}, 'delete').expect(200);
  await profileWrite(owner, `/resumes/${data.resumeId}`, {}, 'delete').expect(
    200,
  );
});
it('keeps secrets encrypted, write-only, scoped and replaceable', async () => {
  const owner = await browserAs(userId),
    stranger = await browserAs(otherId);
  const value = randomBytes(32).toString('hex');
  const path = '/settings/secrets/llm_openai';
  const response = await profileWrite(owner, path, { value }).expect(200);
  expect(response.body).toEqual({
    kind: 'llm_openai',
    configured: true,
    lastFour: value.slice(-4),
  });
  const stored = await db.userSecret.findUniqueOrThrow({
    where: { userId_kind: { userId, kind: 'llm_openai' } },
  });
  expect(Buffer.from(stored.ciphertext).toString()).not.toBe(value);
  expect(stored.iv.byteLength).toBe(12);
  const listed = await request(server)
    .get('/settings/secrets')
    .set('Cookie', owner.cookie)
    .expect(200);
  expect(JSON.stringify(listed.body)).not.toContain(value);
  expect(JSON.stringify(listed.body)).not.toMatch(
    /ciphertext|authTag|keyVersion/,
  );
  const other = await request(server)
    .get(path)
    .set('Cookie', stranger.cookie)
    .expect(200);
  expect(other.body).toEqual({
    kind: 'llm_openai',
    configured: false,
    lastFour: null,
  });
  await profileWrite(stranger, path, {}, 'delete').expect(200);
  expect(await db.userSecret.count({ where: { userId } })).toBe(1);
  const ownOtherValue = randomBytes(32).toString('hex');
  await profileWrite(stranger, path, { value: ownOtherValue }).expect(200);
  expect(
    (await request(server).get(path).set('Cookie', owner.cookie).expect(200))
      .body.lastFour,
  ).toBe(value.slice(-4));
  const replacement = randomBytes(32).toString('hex');
  await profileWrite(owner, path, { value: replacement }).expect(200);
  expect(
    (await request(server).get(path).set('Cookie', owner.cookie).expect(200))
      .body.lastFour,
  ).toBe(replacement.slice(-4));
  const exported = await request(server)
    .get('/users/me/export')
    .set('Cookie', owner.cookie)
    .expect(200);
  expect(JSON.stringify(exported.body)).not.toContain(value);
  expect(JSON.stringify(exported.body)).not.toContain(replacement);
  await profileWrite(owner, path, {}, 'delete').expect(200);
  expect(
    (await request(server).get(path).set('Cookie', owner.cookie).expect(200))
      .body.configured,
  ).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(logs).not.toContain(value);
  expect(logs).not.toContain(replacement);
});
it('persists provider and IMAP preferences without leaking to another user', async () => {
  const owner = await browserAs(userId),
    stranger = await browserAs(otherId);
  const input = {
    llmProvider: 'ollama',
    generationModel: 'local-generation',
    scoringModel: 'local-scoring',
    embeddingProvider: 'ollama',
    embeddingModel: 'bge-m3',
    ollamaBaseUrl: 'http://localhost:11434',
    imap: {
      host: 'imap.example.invalid',
      port: 993,
      username: 'alerts@example.invalid',
      mailbox: 'INBOX',
      allowedSenders: ['alerts@example.invalid'],
    },
  };
  await profileWrite(owner, '/settings', input).expect(200);
  expect(
    (
      await request(server)
        .get('/settings')
        .set('Cookie', owner.cookie)
        .expect(200)
    ).body,
  ).toEqual(input);
  const other = await request(server)
    .get('/settings')
    .set('Cookie', stranger.cookie)
    .expect(200);
  expect(other.body.imap).toBeNull();
  expect(other.body.generationModel).not.toBe(input.generationModel);
  await profileWrite(owner, '/settings', {
    ...input,
    imap: { ...input.imap, password: randomBytes(16).toString('hex') },
  }).expect(400);
  await profileWrite(owner, '/settings', {
    ...input,
    ollamaBaseUrl: 'file:///etc/passwd',
  }).expect(400);
  await profileWrite(owner, '/settings', { ...input, imap: null }).expect(200);
});
it('isolates tracked companies and validates public ATS identifiers', async () => {
  const owner = await browserAs(userId),
    stranger = await browserAs(otherId);
  const input = {
    name: 'Example ATS',
    atsType: 'greenhouse',
    atsToken: 'example-test',
  };
  const response = await profileWrite(
    owner,
    '/settings/companies',
    input,
  ).expect(200);
  const id = String(response.body.id);
  await request(server)
    .get(`/settings/companies/${id}`)
    .set('Cookie', stranger.cookie)
    .expect(404);
  await profileWrite(stranger, `/settings/companies/${id}`, input).expect(404);
  await profileWrite(
    stranger,
    `/settings/companies/${id}`,
    {},
    'delete',
  ).expect(404);
  await profileWrite(owner, '/settings/companies', input).expect(409);
  await profileWrite(owner, `/settings/companies/${id}`, {
    ...input,
    atsType: 'lever',
  }).expect(200);
  await profileWrite(owner, '/settings/companies', {
    ...input,
    atsToken: '../../private',
  }).expect(400);
  await profileWrite(owner, `/settings/companies/${id}`, {}, 'delete').expect(
    200,
  );
});
it('requires authentication, CSRF and valid data on profile routes', async () => {
  await request(server).get('/resumes').expect(401);
  const owner = await browserAs(userId);
  await request(server)
    .post('/resumes')
    .set('Cookie', owner.cookie)
    .send(resumeInput)
    .expect(403);
  await profileWrite(owner, '/resumes', { title: '', data: {} }).expect(400);
  await request(server)
    .get('/resumes/not-a-uuid')
    .set('Cookie', owner.cookie)
    .expect(400);
  await profileWrite(owner, '/settings/secrets/not-a-kind', {
    value: randomBytes(32).toString('hex'),
  }).expect(400);
});

const localAiSettings = {
  llmProvider: 'ollama',
  generationModel: 'test-generation',
  scoringModel: 'test-scoring',
  embeddingProvider: 'ollama',
  embeddingModel: 'test-embedding',
  ollamaBaseUrl: 'http://localhost:11434',
  imap: null,
};
it('preserves manual resumes without credentials and computes embeddings once configured', async () => {
  const owner = await browserAs(userId),
    stranger = await browserAs(otherId);
  const response = await profileWrite(owner, '/resumes', resumeInput).expect(
    200,
  );
  const id = String(response.body.id);
  expect(response.body.embeddingStatus).toBe('not_configured');
  await profileWrite(owner, '/settings', localAiSettings).expect(200);
  for (let i = 0; i < 50; i++) {
    const row = await db.resume.findFirstOrThrow({ where: { userId, id } });
    if (row.embeddingStatus === 'ready') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const record = await db.resume.findFirstOrThrow({ where: { userId, id } });
  expect(record.embeddingStatus).toBe('ready');
  expect(record.embeddingProvider).toBe('ollama');
  const vectors = await db.$queryRaw<
    Array<{ dimensions: number }>
  >`SELECT vector_dims(embedding) AS dimensions FROM resumes WHERE id=${id}::uuid`;
  expect(vectors[0]?.dimensions).toBe(1024);
  await profileWrite(stranger, `/resumes/${id}/embedding`, {}).expect(404);
  const updated = await profileWrite(owner, `/resumes/${id}`, {
    ...resumeInput,
    title: 'Changed title',
  }).expect(200);
  expect(updated.body.embeddingStatus).toBe('ready');
  await profileWrite(owner, '/settings', {
    ...localAiSettings,
    embeddingModel: 'test-failed',
  }).expect(200);
  const retry = await profileWrite(
    owner,
    `/resumes/${id}/embedding`,
    {},
  ).expect(200);
  expect(retry.body.embeddingStatus).toBe('failed');
  expect(
    (await db.resume.findFirstOrThrow({ where: { userId, id } })).title,
  ).toBe('Changed title');
  const stale = await db.$queryRaw<
    Array<{ embedding: string | null }>
  >`SELECT embedding::text FROM resumes WHERE id=${id}::uuid`;
  expect(stale[0]?.embedding).toBeNull();
});
it('switches text providers through settings and proposes PDF data without saving a master', async () => {
  const owner = await browserAs(userId);
  const pdf = await renderResumePdf(syntheticResume);
  for (const provider of ['anthropic', 'openai', 'mistral', 'ollama']) {
    await profileWrite(owner, '/settings', {
      ...localAiSettings,
      llmProvider: provider,
    }).expect(200);
    if (provider !== 'ollama')
      await profileWrite(owner, '/settings/secrets/llm_' + provider, {
        value: randomBytes(24).toString('hex'),
      }).expect(200);
    const proposal = await request(server)
      .post('/resumes/import')
      .set('Cookie', owner.cookie)
      .set('X-CSRF-Token', owner.csrf)
      .set('Origin', origin)
      .set('Content-Type', 'application/pdf')
      .send(pdf)
      .expect(200);
    expect(proposal.body.data.basics.name).toBe(syntheticResume.basics.name);
    expect(llmSelections.at(-1)?.provider).toBe(provider);
  }
  expect(await db.resume.count({ where: { userId } })).toBe(0);
  const usage = await request(server)
    .get('/llm/usage')
    .set('Cookie', owner.cookie)
    .expect(200);
  expect(usage.body.tokensUsed).toBe(240);
  expect(usage.body.tokensReserved).toBe(0);
  expect(usage.body.unpricedCalls).toBe(4);
  const stranger = await browserAs(otherId);
  expect(
    (
      await request(server)
        .get('/llm/usage')
        .set('Cookie', stranger.cookie)
        .expect(200)
    ).body.tokensUsed,
  ).toBe(0);
});
it('rejects invalid model output and unsafe PDF uploads without creating resumes', async () => {
  const owner = await browserAs(userId);
  await profileWrite(owner, '/settings', {
    ...localAiSettings,
    generationModel: 'test-invalid',
  }).expect(200);
  const post = (buffer: Buffer, type = 'application/pdf') =>
    request(server)
      .post('/resumes/import')
      .set('Cookie', owner.cookie)
      .set('X-CSRF-Token', owner.csrf)
      .set('Content-Type', type)
      .send(buffer);
  const invalid = await post(await renderResumePdf(syntheticResume)).expect(
    422,
  );
  expect(invalid.body.error.code).toBe('LLM_INVALID_OUTPUT');
  await post(Buffer.from('not a PDF')).expect(415);
  await post(Buffer.from('%PDF-invalid')).expect(422);
  await post(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
  await post(Buffer.from('invalid'), 'application/octet-stream').expect(415);
  await request(server)
    .post('/resumes/import')
    .set('Cookie', owner.cookie)
    .set('Content-Type', 'application/pdf')
    .send(await renderResumePdf(syntheticResume))
    .expect(403);
  expect(await db.resume.count({ where: { userId } })).toBe(0);
});
it('reserves monthly usage atomically and independently for each user', async () => {
  const repository = new LlmRepository(db);
  const input = {
    purpose: 'test',
    provider: 'ollama',
    model: 'test-model',
    tokens: 15,
    promptVersion: null,
  };
  const results = await Promise.allSettled([
    repository.reserve(userId, input, 20),
    repository.reserve(userId, input, 20),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  await expect(repository.reserve(otherId, input, 20)).resolves.toBeDefined();
  const summary = await repository.summary(userId, 20);
  expect(summary.tokensReserved).toBe(15);
});
it('bounds retries and retains uncertain usage after a timeout', async () => {
  await db.userSettings.create({
    data: { userId, ...localAiSettings, imap: Prisma.DbNull },
  });
  const { CryptoService } = await import('../crypto/crypto.service.ts');
  const crypto = new CryptoService({
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  let attempts = 0;
  const never: LlmProvider = {
    async generateStructured() {
      throw new Error('unused');
    },
    async generateText() {
      attempts++;
      return new Promise(() => {});
    },
    async embed() {
      throw new Error('unused');
    },
  };
  const service = new LlmService(
    new LlmRepository(db),
    crypto,
    llmEnvironmentSchema.parse({ LLM_TIMEOUT_MS: 100, LLM_MAX_RETRIES: 1 }),
    () => never,
  );
  await expect(
    service.generateText(userId, 'timeout-test', {
      version: 'test',
      system: 'Task',
      user: 'Synthetic input',
    }),
  ).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
  expect(attempts).toBe(2);
  expect((await service.summary(userId)).tokensReserved).toBeGreaterThan(0);
  expect(await db.llmUsage.count({ where: { userId, status: 'failed' } })).toBe(
    2,
  );
});

it('does not overwrite a newer resume embedding with a late result', async () => {
  const { ResumeEmbeddings } = await import('../resumes/resume-embeddings.ts');
  const { CryptoService } = await import('../crypto/crypto.service.ts');
  await db.userSettings.create({
    data: { userId, ...localAiSettings, imap: Prisma.DbNull },
  });
  const resume = await db.resume.create({
    data: { userId, title: 'Concurrent CV', data: syntheticResume },
  });
  const crypto = new CryptoService({
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_PREVIOUS_KEYS: {},
  });
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const factory = (selected: ProviderConfiguration): LlmProvider => ({
    ...llmFactory(selected),
    async embed() {
      started?.();
      await gate;
      return {
        value: [1, ...Array<number>(1023).fill(0)],
        usage: { tokensIn: 10, tokensOut: 0 },
      };
    },
  });
  const slow = new ResumeEmbeddings(
    db,
    new LlmService(
      new LlmRepository(db),
      crypto,
      llmEnvironmentSchema.parse({}),
      factory,
    ),
  );
  const first = slow.refresh(userId, resume.id);
  await ready;
  await db.resume.update({
    where: { id: resume.id },
    data: {
      revision: { increment: 1 },
      data: {
        ...syntheticResume,
        basics: {
          ...syntheticResume.basics,
          summary: 'Updated manual content',
        },
      },
    },
  });
  const fastFactory = (selected: ProviderConfiguration): LlmProvider => ({
    ...llmFactory(selected),
    async embed() {
      return {
        value: [0, 1, ...Array<number>(1022).fill(0)],
        usage: { tokensIn: 10, tokensOut: 0 },
      };
    },
  });
  await new ResumeEmbeddings(
    db,
    new LlmService(
      new LlmRepository(db),
      crypto,
      llmEnvironmentSchema.parse({}),
      fastFactory,
    ),
  ).refresh(userId, resume.id);
  release?.();
  await first;
  const rows = await db.$queryRaw<
    Array<{ embedding: string }>
  >`SELECT embedding::text FROM resumes WHERE id=${resume.id}::uuid`;
  expect(JSON.parse(rows[0]?.embedding ?? '[]')).toEqual([
    0,
    1,
    ...Array<number>(1022).fill(0),
  ]);
});
