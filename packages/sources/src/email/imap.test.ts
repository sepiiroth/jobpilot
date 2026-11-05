import { beforeEach, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({
  openStall: false,
  connectFailure: false,
  logoutFailure: false,
  closed: 0,
  options: {} as Record<string, unknown>,
  mailbox: { uidValidity: '42', uidNext: 3, readOnly: true },
  messages: [
    {
      uid: 1,
      size: 20,
      envelope: { from: [{ address: 'alerts@example.invalid' }] },
    },
  ] as Array<{
    uid: number;
    size?: number;
    envelope?: { from?: Array<{ address?: string }> };
  }>,
  chunks: [] as unknown[],
  missing: false,
  streamError: false,
}));
vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
    on() {
      return this;
    }
    async connect() {
      if (state.connectFailure) throw new Error('Sensitive auth error');
    }
    close() {
      state.closed++;
    }
    async logout() {
      if (state.logoutFailure) throw new Error('Disconnected');
    }
    async mailboxOpen() {
      if (state.openStall) return new Promise<never>(() => {});
      return state.mailbox;
    }
    async *fetch() {
      for (const message of state.messages) yield message;
    }
    async download() {
      if (state.missing) return {};
      if (state.streamError)
        return {
          content: Readable.from(
            (async function* () {
              yield Buffer.from('ok');
              throw new Error('Stream failed');
            })(),
          ),
        };
      return { content: Readable.from(state.chunks) };
    }
  },
}));
import { connectImap, parseAlert } from './imap.ts';
const settings = {
  host: 'imap.example.invalid',
  port: 993,
  username: 'synthetic',
  password: 'not-a-credential',
};
beforeEach(() => {
  state.openStall = false;
  state.connectFailure = false;
  state.logoutFailure = false;
  state.closed = 0;
  state.mailbox = { uidValidity: '42', uidNext: 3, readOnly: true };
  state.messages = [
    {
      uid: 1,
      size: 20,
      envelope: { from: [{ address: 'alerts@example.invalid' }] },
    },
  ];
  state.chunks = [Buffer.from('test')];
  state.missing = false;
  state.streamError = false;
});
it('pins the endpoint with TLS verification, disables logging and opens read-only', async () => {
  const client = await connectImap(settings, '8.8.8.8', 15000, 512000);
  expect(state.options).toMatchObject({
    host: '8.8.8.8',
    port: 993,
    servername: 'imap.example.invalid',
    secure: true,
    logger: false,
    disableAutoIdle: true,
    disableCompression: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 15000,
    socketTimeout: 300000,
    maxLiteralSize: 520192,
  });
  expect(await client.open('INBOX')).toEqual({ uidValidity: '42', uidNext: 3 });
  expect(await client.list(1, 2)).toEqual([
    { uid: 1, size: 20, senders: ['alerts@example.invalid'] },
  ]);
  expect((await client.download(1, 10))?.toString()).toBe('test');
  await client.close();
  expect(state.closed).toBe(1);
  await connectImap({ ...settings, host: '8.8.8.8' }, '8.8.8.8', 15000, 512000);
  expect(state.options.servername).toBeUndefined();
});
it('sanitizes connection errors, validates mailbox identity and always closes', async () => {
  state.connectFailure = true;
  await expect(connectImap(settings, '8.8.8.8', 1000, 10000)).rejects.toThrow(
    'EMAIL_CONNECTION_FAILED',
  );
  expect(state.closed).toBe(1);
  state.connectFailure = false;
  const client = await connectImap(settings, '8.8.8.8', 1000, 10000);
  state.mailbox.readOnly = false;
  await expect(client.open('INBOX')).rejects.toThrow(
    'EMAIL_READ_ONLY_REQUIRED',
  );
  state.mailbox.readOnly = true;
  state.mailbox.uidValidity = 'invalid';
  await expect(client.open('INBOX')).rejects.toThrow('EMAIL_INVALID_MAILBOX');
  state.mailbox.uidValidity = '42';
  state.mailbox.uidNext = 0;
  await expect(client.open('INBOX')).rejects.toThrow('EMAIL_INVALID_MAILBOX');
  state.logoutFailure = true;
  await client.close();
  expect(state.closed).toBe(2);
});
it('bounds metadata, raw downloads and malformed server replies', async () => {
  const client = await connectImap(settings, '8.8.8.8', 1000, 10000);
  state.messages = [
    { uid: 1, size: 1 },
    { uid: 1, size: 1 },
  ];
  await expect(client.list(1, 1)).rejects.toThrow('EMAIL_INVALID_RESPONSE');
  for (const message of [
    { uid: 9, size: 1 },
    { uid: 1, size: -1 },
    { uid: 0, size: 1 },
    { uid: 1 },
  ]) {
    state.messages = [message];
    await expect(client.list(1, 2)).rejects.toThrow('EMAIL_INVALID_RESPONSE');
  }
  state.messages = [
    { uid: 1, size: 20, envelope: { from: [{}] } },
    { uid: 2, size: 10 },
  ];
  expect(await client.list(1, 2)).toEqual([
    { uid: 1, size: 20, senders: [''] },
    { uid: 2, size: 10, senders: [] },
  ]);
  state.missing = true;
  expect(await client.download(1, 10)).toBeNull();
  state.missing = false;
  state.chunks = [Buffer.alloc(11)];
  await expect(client.download(1, 10)).rejects.toThrow(
    'EMAIL_MESSAGE_TOO_LARGE',
  );
  state.chunks = [{}];
  await expect(client.download(1, 10)).rejects.toThrow(
    'EMAIL_INVALID_RESPONSE',
  );
  state.streamError = true;
  await expect(client.download(1, 10)).rejects.toThrow('Stream failed');
  state.streamError = false;
  state.chunks = ['plain'];
  expect((await client.download(1, 10))?.toString()).toBe('plain');
  await client.close();
});
it('parses MIME without keeping contacts or tracking URLs in model text', async () => {
  const raw = readFileSync(
    new URL('./__fixtures__/allowed.eml', import.meta.url),
  );
  const parsed = await parseAlert(raw);
  expect(parsed.senders).toEqual(['alerts@example.invalid']);
  expect(parsed.links).toContain('https://jobs.example.invalid/role-42');
  expect(parsed.text).not.toContain('recruiter@example.invalid');
  expect(parsed.text).not.toContain('+33123456789');
  expect(parsed.text).not.toContain('utm_');
  const html = await parseAlert(
    Buffer.from(
      'Content-Type: text/html; charset=utf-8\r\n\r\n<p>Engineer</p>',
    ),
  );
  expect(html.senders).toEqual([]);
  expect(html.text).toBe('Engineer');
});

it('bounds the whole IMAP operation even when a server remains connected without completing it', async () => {
  const client = await connectImap(settings, '8.8.8.8', 20, 10000);
  state.openStall = true;
  await expect(client.open('INBOX')).rejects.toThrow('EMAIL_CONNECTION_FAILED');
  expect(state.closed).toBe(1);
  await client.close();
});
