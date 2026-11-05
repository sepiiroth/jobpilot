import { Prisma, type PrismaClient } from '@jobpilot/db';
import type {
  ProfileSettings,
  CompanyInput,
  SecretKind,
} from '@jobpilot/shared/profile';
import type { EncryptedSecret } from '../crypto/crypto.service.ts';
export class SettingsRepository {
  constructor(private readonly db: PrismaClient) {}
  settings(userId: string) {
    return this.db.userSettings.findUnique({ where: { userId } });
  }
  saveSettings(userId: string, input: ProfileSettings) {
    const data = {
      ...input,
      imap:
        input.imap === null
          ? Prisma.DbNull
          : (input.imap as Prisma.InputJsonValue),
    };
    return this.db.$transaction(async (tx) => {
      const result = await tx.userSettings.upsert({
        where: { userId },
        create: { ...data, userId },
        update: data,
      });
      await tx.searchMatch.deleteMany({ where: { userId } });
      return result;
    });
  }
  secrets(userId: string) {
    return this.db.userSecret.findMany({ where: { userId } });
  }
  secret(userId: string, kind: SecretKind) {
    return this.db.userSecret.findUnique({
      where: { userId_kind: { userId, kind } },
    });
  }
  saveSecret(userId: string, kind: SecretKind, value: EncryptedSecret) {
    const data = {
      ciphertext: new Uint8Array(value.ciphertext),
      iv: new Uint8Array(value.iv),
      authTag: new Uint8Array(value.authTag),
      keyVersion: value.keyVersion,
    };
    return this.db.userSecret.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, ...data },
      update: data,
    });
  }
  deleteSecret(userId: string, kind: SecretKind) {
    return this.db.userSecret.deleteMany({ where: { userId, kind } });
  }
  companies(userId: string) {
    return this.db.trackedCompany.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }
  company(userId: string, id: string) {
    return this.db.trackedCompany.findFirst({ where: { userId, id } });
  }
  async saveCompany(
    userId: string,
    id: string | undefined,
    input: CompanyInput,
  ) {
    if (!id)
      return this.db.trackedCompany.create({ data: { ...input, userId } });
    if (
      !(
        await this.db.trackedCompany.updateMany({
          where: { userId, id },
          data: input,
        })
      ).count
    )
      return null;
    return this.company(userId, id);
  }
  async deleteCompany(userId: string, id: string) {
    return (await this.db.trackedCompany.deleteMany({ where: { userId, id } }))
      .count;
  }
}
