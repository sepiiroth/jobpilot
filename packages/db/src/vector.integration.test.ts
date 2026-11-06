import { afterAll, beforeAll, it, expect } from 'vitest';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  createDatabaseClient,
  VectorRepository,
  type PrismaClient,
} from './index.ts';
let container: StartedTestContainer | undefined;
let db: PrismaClient;
beforeAll(async () => {
  const password = randomBytes(24).toString('hex');
  container = await new GenericContainer('jobpilot-db:phase12')
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
  const url = `postgresql://jobpilot:${password}@${container.getHost()}:${container.getMappedPort(5432)}/jobpilot`;
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
  );
  db = createDatabaseClient(url);
}, 120000);
afterAll(async () => {
  if (db) await db.$disconnect();
  await container?.stop();
});
it('ranks embeddings, enforces tenant ownership and cascades deletion', async () => {
  const user = await db.user.create({
    data: { email: 'vector@example.invalid', passwordHash: 'not-a-login-hash' },
  });
  const other = await db.user.create({
    data: { email: 'other@example.invalid', passwordHash: 'not-a-login-hash' },
  });
  const resume = await db.resume.create({
    data: { userId: user.id, title: 'Synthetic', data: {} },
  });
  const search = await db.search.create({
    data: {
      userId: user.id,
      resumeId: resume.id,
      name: 'Synthetic',
      titles: [],
      includeKeywords: [],
      excludeKeywords: [],
      locations: [],
      remote: [],
      contractTypes: [],
      sources: [],
    },
  });
  await expect(
    db.search.create({
      data: {
        userId: other.id,
        resumeId: resume.id,
        name: 'Forbidden',
        titles: [],
        includeKeywords: [],
        excludeKeywords: [],
        locations: [],
        remote: [],
        contractTypes: [],
        sources: [],
      },
    }),
  ).rejects.toThrow();
  const repo = new VectorRepository(db);
  const a = Array<number>(1024).fill(0);
  a[0] = 1;
  const b = Array<number>(1024).fill(0);
  b[1] = 1;
  const ids: string[] = [];
  for (const [i, embedding] of [a, b].entries()) {
    const offer = await db.jobOffer.create({
      data: {
        sourceId: 'greenhouse',
        externalId: String(i),
        dedupKey: String(i),
        url: 'https://example.invalid/jobs/' + i,
        alternateUrls: [],
        title: 'Synthetic',
        company: 'Synthetic',
        location: {},
        remote: 'full',
        contractType: 'permanent',
        description: 'Synthetic test offer',
      },
    });
    ids.push(offer.id);
    await db.userJobMatch.create({
      data: {
        userId: user.id,
        jobOfferId: offer.id,
        searchId: search.id,
        hardFilterPassed: true,
      },
    });
    await repo.setJobEmbedding(offer.id, embedding);
  }
  await repo.setResumeEmbedding(user.id, resume.id, a);
  await expect(repo.setResumeEmbedding(other.id, resume.id, a)).rejects.toThrow(
    'Resume not found',
  );
  const nearest = await repo.findNearest(user.id, a);
  expect(nearest[0]?.id).toBe(ids[0]);
  expect(nearest[0]?.similarity).toBeCloseTo(1);
  expect(await repo.findNearest(other.id, a)).toEqual([]);
  const firstId = ids[0];
  if (!firstId) throw new Error('Missing fixture offer');
  await db.userJobMatch.updateMany({
    where: { userId: user.id, jobOfferId: firstId },
    data: { status: 'ignored' },
  });
  expect((await repo.findNearest(user.id, a)).map((v) => v.id)).not.toContain(
    ids[0],
  );
  await expect(repo.findNearest(user.id, [1])).rejects.toThrow();
  await db.user.delete({ where: { id: user.id } });
  expect(await db.resume.count({ where: { userId: user.id } })).toBe(0);
  expect(await db.userJobMatch.count({ where: { userId: user.id } })).toBe(0);
  expect(await db.jobOffer.count()).toBe(2);
}, 30000);
