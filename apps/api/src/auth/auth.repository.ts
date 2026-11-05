import type { PrismaClient, Prisma } from '@jobpilot/db';
export class AuthRepository {
  private readonly db: PrismaClient;
  constructor(db: PrismaClient) {
    this.db = db;
  }
  userByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }
  userById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      select: { id: true, email: true, locale: true, createdAt: true },
    });
  }
  session(tokenHash: string) {
    return this.db.session.findUnique({ where: { tokenHash } });
  }
  async createSession(
    userId: string,
    passwordHash: string,
    data: {
      tokenHash: string;
      expiresAt: Date;
      ip: string | null;
      userAgent: string | null;
    },
  ) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM users WHERE id=${userId}::uuid AND "passwordHash"=${passwordHash} FOR UPDATE`;
      if (rows.length !== 1) return null;
      return tx.session.create({ data: { userId, ...data } });
    });
  }
  touchSession(id: string, userId: string, now: Date, expiresAt: Date) {
    return this.db.session.updateMany({
      where: {
        id,
        userId,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - 30 * 86400000) },
      },
      data: { lastSeenAt: now, expiresAt },
    });
  }
  removeSession(id: string, userId: string) {
    return this.db.session.deleteMany({ where: { id, userId } });
  }
  removeSessions(userId: string) {
    return this.db.session.deleteMany({ where: { userId } });
  }
  async changePassword(
    userId: string,
    previousHash: string,
    passwordHash: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, passwordHash: previousHash },
        data: { passwordHash },
      });
      if (updated.count !== 1) return false;
      await tx.session.deleteMany({ where: { userId } });
      return true;
    });
  }
  audit(userId: string, action: string, ip: string | null) {
    return this.db.auditLog.create({
      data: { userId, action, ip, metadata: {} },
    });
  }
}
export type AuthTransaction = Prisma.TransactionClient;
