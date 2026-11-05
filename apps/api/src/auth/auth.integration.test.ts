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
import { createDatabaseClient, type PrismaClient } from '@jobpilot/db';
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
