import { createDatabaseClient } from './index.ts';
import { resumeSchema, searchSchema } from '@jobpilot/shared';
if (process.env.NODE_ENV === 'production')
  throw new Error('Development seed is disabled in production');
const hash = process.env.SEED_PASSWORD_HASH;
if (
  !hash ||
  !/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(
    hash,
  )
)
  throw new Error('Set SEED_PASSWORD_HASH to an argon2id hash');
const db = createDatabaseClient();
try {
  await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: 'demo@example.invalid' },
      update: {},
      create: { email: 'demo@example.invalid', passwordHash: hash },
    });
    const existing = await tx.resume.findFirst({
      where: { userId: user.id, title: 'Fictional development resume' },
    });
    const data = resumeSchema.parse({
      basics: {
        name: 'Fictional Demo',
        summary: 'Synthetic development fixture. No real work history.',
      },
      skills: [{ name: 'TypeScript' }],
    });
    const resume =
      existing ??
      (await tx.resume.create({
        data: { userId: user.id, title: 'Fictional development resume', data },
      }));
    for (const title of ['TypeScript Developer', 'Backend Developer']) {
      const criteria = searchSchema.parse({
        name: title,
        resumeId: resume.id,
        titles: [title],
        locations: [],
        remote: ['full'],
        contractTypes: ['permanent'],
        sources: ['greenhouse'],
      });
      const found = await tx.search.findFirst({
        where: { userId: user.id, name: title },
      });
      if (!found)
        await tx.search.create({
          data: {
            ...criteria,
            radiusKm: criteria.radiusKm ?? null,
            salaryMin: criteria.salaryMin ?? null,
            seniority: criteria.seniority ?? null,
            userId: user.id,
          },
        });
    }
  });
  console.log('Development seed completed');
} finally {
  await db.$disconnect();
}
