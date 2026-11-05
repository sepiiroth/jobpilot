import { createHash } from 'node:crypto';
import {
  EmailRepository,
  emailAccountKey,
  type PrismaClient,
} from '@jobpilot/db';
import {
  normalizedJobOfferSchema,
  type NormalizedJobOffer,
} from '@jobpilot/shared';
import { imapSettingsSchema } from '@jobpilot/shared/profile';
import {
  emailEnvironmentSchema,
  emailExtractionSchema,
  type EmailEnvironment,
} from '@jobpilot/shared/email';
import { CryptoService } from '@jobpilot/shared/crypto';
import { LlmService, emailAlertPrompt } from '@jobpilot/llm';
import {
  connectImap,
  parseAlert,
  resolveImapHost,
  cleanEmailLink,
  cleanText,
  SourceError,
  type EmailConnectionFactory,
  type Resolver,
} from '@jobpilot/sources';
export interface EmailCollectionResult {
  offers: NormalizedJobOffer[];
  warning?: string;
}
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export class EmailAlerts {
  private readonly config: EmailEnvironment;
  constructor(
    private readonly db: PrismaClient,
    private readonly llm: LlmService,
    private readonly crypto: CryptoService,
    config: EmailEnvironment = emailEnvironmentSchema.parse({}),
    private readonly connect: EmailConnectionFactory = connectImap,
    private readonly resolver?: Resolver,
  ) {
    this.config = config;
  }
  async configured(userId: string) {
    const settings = await this.db.userSettings.findUnique({
      where: { userId },
    });
    const imap = imapSettingsSchema.safeParse(settings?.imap);
    if (!imap.success) return false;
    return (
      this.allowed(imap.data.allowedSenders).length > 0 &&
      !!(await this.db.userSecret.findUnique({
        where: { userId_kind: { userId, kind: 'imap' } },
      }))
    );
  }
  private allowed(senders: string[]) {
    const local = senders.map((s) => s.toLowerCase()),
      global = this.config.EMAIL_ALERT_ALLOWED_SENDERS;
    return [
      ...new Set(
        local.length
          ? global.length
            ? local.filter((s) => global.includes(s))
            : local
          : global,
      ),
    ];
  }
  async collect(
    userId: string,
    permit: () => Promise<void>,
    deadline: number,
  ): Promise<EmailCollectionResult> {
    const settings = await this.db.userSettings.findUnique({
        where: { userId },
      }),
      parsed = imapSettingsSchema.safeParse(settings?.imap);
    if (!parsed.success) throw new SourceError('SOURCE_NOT_CONFIGURED');
    const imap = parsed.data,
      allowed = this.allowed(imap.allowedSenders);
    const encrypted = await this.db.userSecret.findUnique({
      where: { userId_kind: { userId, kind: 'imap' } },
    });
    if (!allowed.length || !encrypted)
      throw new SourceError('SOURCE_NOT_CONFIGURED');
    const address = await resolveImapHost(
      imap.host,
      this.config.ALLOW_PRIVATE_IMAP_HOST,
      this.config.EMAIL_ALERT_TIMEOUT_MS,
      this.resolver,
    );
    const password = this.crypto.decrypt(
      {
        ...encrypted,
        ciphertext: Buffer.from(encrypted.ciphertext),
        iv: Buffer.from(encrypted.iv),
        authTag: Buffer.from(encrypted.authTag),
      },
      `${userId}:imap`,
    );
    await permit();
    const connection = await this.connect(
      { ...imap, password },
      address,
      this.config.EMAIL_ALERT_TIMEOUT_MS,
      this.config.EMAIL_ALERT_MAX_BYTES,
    );
    const repository = new EmailRepository(this.db),
      accountKey = emailAccountKey(
        imap.host,
        imap.port,
        imap.username,
        imap.mailbox,
      );
    let warning: string | undefined;
    let validity: string | undefined;
    try {
      const identity = await connection.open(imap.mailbox),
        mailbox = await repository.mailbox(
          userId,
          accountKey,
          identity.uidValidity,
        );
      validity = identity.uidValidity;
      const lower = Number(mailbox.lastUid) + 1,
        upper = Math.min(
          identity.uidNext - 1,
          lower + this.config.EMAIL_ALERT_MAX_MESSAGES - 1,
        );
      if (upper >= lower) {
        await permit();
        const messages = await connection.list(lower, upper);
        for (const message of messages) {
          if (Date.now() > deadline) {
            warning = 'COLLECTION_TIME_LIMIT';
            break;
          }
          const uid = String(message.uid),
            scope = {
              userId,
              accountKey,
              uidValidity: identity.uidValidity,
              uid,
            };
          if (
            await this.db.emailMessage.findUnique({
              where: { userId_accountKey_uidValidity_uid: scope },
            })
          ) {
            await repository.advance(userId, mailbox.id, message.uid);
            continue;
          }
          const sender =
            message.senders.length === 1
              ? message.senders[0]!.trim().toLowerCase()
              : '';
          if (!allowed.includes(sender)) {
            await repository.claim(
              userId,
              accountKey,
              identity.uidValidity,
              uid,
              'ignored',
              'EMAIL_SENDER_BLOCKED',
            );
          } else if (message.size > this.config.EMAIL_ALERT_MAX_BYTES) {
            warning = 'EMAIL_MESSAGE_TOO_LARGE';
            await repository.claim(
              userId,
              accountKey,
              identity.uidValidity,
              uid,
              'ignored',
              warning,
              hash(sender),
            );
          } else {
            try {
              await permit();
              const source = await connection.download(
                message.uid,
                this.config.EMAIL_ALERT_MAX_BYTES,
              );
              if (!source) {
                await repository.claim(
                  userId,
                  accountKey,
                  identity.uidValidity,
                  uid,
                  'ignored',
                  'EMAIL_MESSAGE_REMOVED',
                );
              } else {
                const mail = await parseAlert(source);
                const senderMatches =
                  mail.senders.length === 1 &&
                  mail.senders[0]!.trim().toLowerCase() === sender;
                if (!senderMatches)
                  await repository.claim(
                    userId,
                    accountKey,
                    identity.uidValidity,
                    uid,
                    'ignored',
                    'EMAIL_SENDER_BLOCKED',
                  );
                else if (
                  await repository.claim(
                    userId,
                    accountKey,
                    identity.uidValidity,
                    uid,
                    'processing',
                    null,
                    hash(sender),
                  )
                ) {
                  try {
                    const extraction =
                      mail.links.length && mail.text
                        ? await this.llm.generateStructured(
                            userId,
                            'email_extraction',
                            emailAlertPrompt(mail.text, mail.links),
                            emailExtractionSchema,
                            'scoring',
                          )
                        : { jobs: [] };
                    const offered: NormalizedJobOffer[] = [];
                    for (const job of extraction.jobs) {
                      const url = cleanEmailLink(job.url);
                      if (!url || !mail.links.includes(url))
                        throw new SourceError('EMAIL_UNGROUNDED_LINK');
                      offered.push(
                        normalizedJobOfferSchema.parse({
                          ...job,
                          title: cleanText(job.title),
                          company: cleanText(job.company),
                          description: cleanText(job.description),
                          url,
                          sourceId: 'email',
                          externalId:
                            userId +
                            ':' +
                            hash(
                              accountKey +
                                ':' +
                                identity.uidValidity +
                                ':' +
                                uid +
                                ':' +
                                url,
                            ),
                          fetchedAt: new Date().toISOString(),
                        }),
                      );
                    }
                    await repository.finish(
                      userId,
                      accountKey,
                      identity.uidValidity,
                      uid,
                      offered,
                    );
                  } catch {
                    warning = 'EMAIL_EXTRACTION_FAILED';
                    await repository.finish(
                      userId,
                      accountKey,
                      identity.uidValidity,
                      uid,
                      null,
                      warning,
                    );
                  }
                }
              }
            } catch (error) {
              warning =
                error instanceof SourceError
                  ? error.code
                  : 'EMAIL_MESSAGE_FAILED';
              if (
                error instanceof SourceError &&
                error.code === 'EMAIL_MESSAGE_TOO_LARGE'
              )
                await repository.claim(
                  userId,
                  accountKey,
                  identity.uidValidity,
                  uid,
                  'ignored',
                  warning,
                  hash(sender),
                );
              else throw new SourceError(warning);
            }
          }
          await repository.advance(userId, mailbox.id, message.uid);
        }
        if (!warning || warning !== 'COLLECTION_TIME_LIMIT')
          await repository.advance(userId, mailbox.id, upper);
        if (upper < identity.uidNext - 1) warning ??= 'EMAIL_MESSAGE_LIMIT';
      }
      const cached = await repository.cached(
        userId,
        accountKey,
        identity.uidValidity,
        this.config.EMAIL_ALERT_CACHE_MESSAGES,
        allowed.map(hash),
      );
      warning ??= cached.uncertain
        ? 'EMAIL_EXTRACTION_UNCERTAIN'
        : cached.limited
          ? 'EMAIL_CACHE_LIMIT'
          : undefined;
      return { offers: cached.offers, ...(warning ? { warning } : {}) };
    } catch (error) {
      const code =
        error instanceof SourceError ? error.code : 'EMAIL_CONNECTION_FAILED';
      if (validity) {
        const cached = await repository.cached(
          userId,
          accountKey,
          validity,
          this.config.EMAIL_ALERT_CACHE_MESSAGES,
          allowed.map(hash),
        );
        return { offers: cached.offers, warning: code };
      }
      throw new SourceError(code);
    } finally {
      await connection.close();
    }
  }
}
