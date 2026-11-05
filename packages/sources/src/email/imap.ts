import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { isIP } from 'node:net';
import { SourceError } from '../types.ts';
import { cleanEmailText, emailLinks } from './links.ts';
export interface MailboxIdentity {
  uidValidity: string;
  uidNext: number;
}
export interface EmailMetadata {
  uid: number;
  size: number;
  senders: string[];
}
export interface EmailConnection {
  open(mailbox: string): Promise<MailboxIdentity>;
  list(from: number, to: number): Promise<EmailMetadata[]>;
  download(uid: number, limit: number): Promise<Buffer | null>;
  close(): Promise<void>;
}
export interface ImapSettings {
  host: string;
  port: number;
  username: string;
  password: string;
}
export type EmailConnectionFactory = (
  settings: ImapSettings,
  address: string,
  timeoutMs: number,
  maxBytes: number,
) => Promise<EmailConnection>;
export const connectImap: EmailConnectionFactory = async (
  settings,
  address,
  timeoutMs,
  maxBytes,
) => {
  const client = new ImapFlow({
    host: address,
    port: settings.port,
    secure: true,
    ...(!isIP(settings.host) ? { servername: settings.host } : {}),
    auth: { user: settings.username, pass: settings.password },
    logger: false,
    disableAutoIdle: true,
    disableCompression: true,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    // AI extraction happens between IMAP commands; active operations have their own bounded timer.
    socketTimeout: Math.max(300000, timeoutMs),
    maxLineLength: 65536,
    maxLiteralSize: maxBytes + 8192,
    maxResponseSize: maxBytes + 65536,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
  client.on('error', () => {});
  async function bounded<T>(run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            client.close();
            reject(new SourceError('EMAIL_CONNECTION_FAILED'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  try {
    await bounded(() => client.connect());
  } catch {
    client.close();
    throw new SourceError('EMAIL_CONNECTION_FAILED');
  }
  return {
    async open(mailbox) {
      return bounded(async () => {
        const value = await client.mailboxOpen(mailbox, { readOnly: true });
        if (!value.readOnly) throw new SourceError('EMAIL_READ_ONLY_REQUIRED');
        const uidValidity = String(value.uidValidity),
          uidNext = value.uidNext;
        if (
          !/^\d{1,20}$/.test(uidValidity) ||
          !Number.isSafeInteger(uidNext) ||
          uidNext < 1 ||
          uidNext > 4294967296
        )
          throw new SourceError('EMAIL_INVALID_MAILBOX');
        return { uidValidity, uidNext };
      });
    },
    async list(from, to) {
      return bounded(async () => {
        const rows: EmailMetadata[] = [];
        for await (const item of client.fetch(
          `${from}:${to}`,
          { uid: true, envelope: true, size: true },
          { uid: true },
        )) {
          if (
            !Number.isSafeInteger(item.uid) ||
            item.uid < from ||
            item.uid > to ||
            !Number.isSafeInteger(item.size) ||
            item.size! < 0
          )
            throw new SourceError('EMAIL_INVALID_RESPONSE');
          rows.push({
            uid: item.uid,
            size: item.size!,
            senders: (item.envelope?.from ?? []).map(
              (sender) => sender.address ?? '',
            ),
          });
          if (rows.length > to - from + 1)
            throw new SourceError('EMAIL_INVALID_RESPONSE');
        }
        return rows.sort((a, b) => a.uid - b.uid);
      });
    },
    async download(uid, limit) {
      return bounded(async () => {
        const { content } = await client.download(uid, undefined, {
          uid: true,
          maxBytes: limit + 1,
          chunkSize: 65536,
        });
        if (!content) return null;
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          for await (const chunk of content) {
            const part: unknown = chunk;
            if (!(part instanceof Uint8Array) && typeof part !== 'string')
              throw new SourceError('EMAIL_INVALID_RESPONSE');
            const data = Buffer.from(part);
            size += data.length;
            if (size > limit) {
              content.destroy();
              throw new SourceError('EMAIL_MESSAGE_TOO_LARGE');
            }
            chunks.push(data);
          }
          return Buffer.concat(chunks);
        } catch (error) {
          content.destroy();
          throw error;
        }
      });
    },
    async close() {
      try {
        await bounded(() => client.logout());
      } catch {
        /* A disconnected session needs no LOGOUT. */
      } finally {
        client.close();
      }
    },
  };
};
export async function parseAlert(source: Buffer) {
  const parsed = await simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
    maxHtmlLengthToParse: source.length * 8,
  });
  const text = parsed.text ?? '',
    html = typeof parsed.html === 'string' ? parsed.html : '';
  return {
    senders: parsed.from?.value.map((sender) => sender.address ?? '') ?? [],
    text: cleanEmailText(text, html),
    links: emailLinks(text, html),
  };
}
