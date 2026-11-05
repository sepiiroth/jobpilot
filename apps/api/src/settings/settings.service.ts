import {
  companyInputSchema,
  companyRecordSchema,
  profileSettingsSchema,
  secretInputSchema,
  secretKindSchema,
  type SecretKind,
  type SecretStatus,
} from '@jobpilot/shared/profile';
import { ApiError } from '../common/errors.ts';
import { CryptoService } from '../crypto/crypto.service.ts';
import { SettingsRepository } from './settings.repository.ts';
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly crypto: CryptoService,
  ) {}
  async get(userId: string) {
    const value = await this.repository.settings(userId);
    return profileSettingsSchema.parse(
      value ?? {
        llmProvider: 'anthropic',
        generationModel: 'claude-sonnet-5-5',
        scoringModel: 'claude-haiku-5-5',
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        ollamaBaseUrl: 'http://localhost:11434',
        imap: null,
      },
    );
  }
  async save(userId: string, input: unknown) {
    const value = profileSettingsSchema.parse(input);
    await this.repository.saveSettings(userId, value);
    return value;
  }
  async secrets(userId: string): Promise<SecretStatus[]> {
    const values = await this.repository.secrets(userId);
    return secretKindSchema.options.map((kind) => {
      const value = values.find((v) => v.kind === kind);
      return {
        kind,
        configured: !!value,
        lastFour: value
          ? this.crypto
              .decrypt(
                {
                  ...value,
                  ciphertext: Buffer.from(value.ciphertext),
                  iv: Buffer.from(value.iv),
                  authTag: Buffer.from(value.authTag),
                },
                `${userId}:${kind}`,
              )
              .slice(-4)
          : null,
      };
    });
  }
  async secret(userId: string, kind: SecretKind) {
    return (await this.secrets(userId)).find((v) => v.kind === kind);
  }
  async saveSecret(userId: string, kind: SecretKind, input: unknown) {
    const { value } = secretInputSchema.parse(input);
    await this.repository.saveSecret(
      userId,
      kind,
      this.crypto.encrypt(value, `${userId}:${kind}`),
    );
    return { kind, configured: true, lastFour: value.slice(-4) };
  }
  async deleteSecret(userId: string, kind: SecretKind) {
    await this.repository.deleteSecret(userId, kind);
    return { kind, configured: false, lastFour: null };
  }
  async companies(userId: string) {
    return (await this.repository.companies(userId)).map((v) =>
      companyRecordSchema.parse(v),
    );
  }
  async company(userId: string, id: string) {
    const value = await this.repository.company(userId, id);
    if (!value) throw new ApiError(404, 'NOT_FOUND', 'Company not found');
    return companyRecordSchema.parse(value);
  }
  async saveCompany(userId: string, id: string | undefined, input: unknown) {
    try {
      const value = await this.repository.saveCompany(
        userId,
        id,
        companyInputSchema.parse(input),
      );
      if (!value) throw new ApiError(404, 'NOT_FOUND', 'Company not found');
      return companyRecordSchema.parse(value);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ApiError(409, 'COMPANY_EXISTS', 'Company already tracked');
      throw error;
    }
  }
  async deleteCompany(userId: string, id: string) {
    if (!(await this.repository.deleteCompany(userId, id)))
      throw new ApiError(404, 'NOT_FOUND', 'Company not found');
    return { ok: true };
  }
}
