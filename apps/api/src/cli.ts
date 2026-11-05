import { z } from 'zod';
import { createDatabaseClient } from '@jobpilot/db';
import { Passwords } from './auth/passwords.ts';
const command = process.argv[2];
try {
  if (!['user:create', 'user:reset-password'].includes(command ?? ''))
    throw new Error('Use user:create or user:reset-password');
  const input = z
    .object({
      CLI_USER_EMAIL: z.email().transform((v) => v.toLowerCase()),
      CLI_USER_PASSWORD: z.string().min(12).max(1024),
    })
    .parse(process.env);
  const db = createDatabaseClient();
  try {
    const passwordHash = await new Passwords().hash(input.CLI_USER_PASSWORD);
    await db.$transaction(async (tx) => {
      if (command === 'user:create') {
        await tx.user.create({
          data: { email: input.CLI_USER_EMAIL, passwordHash },
        });
      } else {
        const user = await tx.user.update({
          where: { email: input.CLI_USER_EMAIL },
          data: { passwordHash },
        });
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'auth.password_reset',
            metadata: {},
          },
        });
      }
    });
    console.log(
      command === 'user:create'
        ? 'User created'
        : 'Password reset; all sessions revoked',
    );
  } finally {
    await db.$disconnect();
  }
} catch {
  console.error(
    'Account command failed. Check the command, CLI_USER_EMAIL, CLI_USER_PASSWORD and database configuration.',
  );
  process.exitCode = 1;
}
