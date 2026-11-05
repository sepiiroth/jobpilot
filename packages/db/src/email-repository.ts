import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from './index.ts';
import {
  normalizedJobOfferSchema,
  type NormalizedJobOffer,
} from '@jobpilot/shared';
import { z } from 'zod';
export const emailAccountKey = (
  host: string,
  port: number,
  username: string,
  mailbox: string,
) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        host.toLowerCase(),
        port,
        username,
        mailbox.toUpperCase() === 'INBOX' ? 'INBOX' : mailbox,
      ]),
    )
    .digest('hex');
export class EmailRepository {
  constructor(private readonly db: PrismaClient) {}
  async mailbox(userId: string, accountKey: string, uidValidity: string) {
    return this.db.emailMailbox.upsert({
      where: {
        userId_accountKey_uidValidity: { userId, accountKey, uidValidity },
      },
      create: { userId, accountKey, uidValidity },
      update: {},
    });
  }
  async claim(
    userId: string,
    accountKey: string,
    uidValidity: string,
    uid: string,
    status = 'processing',
    errorCode: string | null = null,
    senderKey: string | null = null,
  ) {
    return (
      (
        await this.db.emailMessage.createMany({
          data: {
            userId,
            accountKey,
            uidValidity,
            uid,
            status,
            errorCode,
            senderKey,
          },
          skipDuplicates: true,
        })
      ).count === 1
    );
  }
  async finish(
    userId: string,
    accountKey: string,
    uidValidity: string,
    uid: string,
    offers: NormalizedJobOffer[] | null,
    errorCode: string | null = null,
  ) {
    await this.db.emailMessage.updateMany({
      where: { userId, accountKey, uidValidity, uid, status: 'processing' },
      data: {
        status: offers ? 'completed' : 'failed',
        errorCode,
        offers: offers ? (offers as Prisma.InputJsonValue) : [],
      },
    });
  }
  async advance(userId: string, id: string, uid: number) {
    // Decimal strings avoid truncating unsigned IMAP UIDs to PostgreSQL's signed integer.
    await this.db
      .$executeRaw`UPDATE email_mailboxes SET "lastUid"=${String(uid)} WHERE id=${id}::uuid AND "userId"=${userId}::uuid AND "lastUid"::bigint<${uid}::bigint`;
  }
  async cached(
    userId: string,
    accountKey: string,
    uidValidity: string,
    limit: number,
    senderKeys: string[],
  ) {
    const rows = await this.db.emailMessage.findMany({
      where: {
        userId,
        accountKey,
        uidValidity,
        senderKey: { in: senderKeys },
        status: { in: ['completed', 'failed', 'processing'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    return {
      offers: rows
        .slice(0, limit)
        .flatMap((row) => z.array(normalizedJobOfferSchema).parse(row.offers)),
      uncertain: rows.some((row) => row.status !== 'completed'),
      limited: rows.length > limit,
    };
  }
}
