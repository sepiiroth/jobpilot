import { describe, it, expect } from 'vitest';
import { allowedImapAddress, resolveImapHost } from './network.ts';
import { cleanEmailLink, cleanEmailText, emailLinks } from './links.ts';
import { EmailAlertSource } from './adapter.ts';
import { searchSchema, normalizedJobOfferSchema } from '@jobpilot/shared';
import type { SourceContext } from '../types.ts';
const criteria = searchSchema.parse({
  name: 'Example',
  resumeId: '00000000-0000-4000-8000-000000000001',
  titles: ['Engineer'],
  remote: [],
  contractTypes: [],
  sources: ['email'],
});
const offer = normalizedJobOfferSchema.parse({
  sourceId: 'email',
  externalId: 'synthetic',
  url: 'https://example.invalid/job',
  title: 'Engineer',
  company: 'Example',
  description: 'Synthetic vacancy',
  location: { city: '', country: 'ZZ' },
  remote: 'unknown',
  contractType: 'unknown',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  publishedAt: null,
  fetchedAt: '2026-11-05T12:00:00Z',
});
describe('IMAP endpoint policy', () => {
  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2001:db8::1',
    '2002:7f00::1',
    '2001::1',
    '3fff::1',
    'fe80::1%eth0',
    'invalid',
  ])('rejects non-public address %s', (value) =>
    expect(allowedImapAddress(value)).toBe(false),
  );
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '2001:4860:4860:0:0:0:0:8888',
  ])('accepts public address %s', (value) =>
    expect(allowedImapAddress(value)).toBe(true),
  );
  it('requires explicit private-network access while always refusing link-local metadata', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      'fc00::1',
      '::1',
      '::ffff:127.0.0.1',
    ])
      expect(allowedImapAddress(ip, true)).toBe(true);
    expect(allowedImapAddress('169.254.169.254', true)).toBe(false);
  });
  it('pins a validated address and refuses mixed DNS answers, failures and timeouts', async () => {
    expect(
      await resolveImapHost('imap.example.invalid', false, 100, async () => [
        { address: '8.8.8.8', family: 4 },
      ]),
    ).toBe('8.8.8.8');
    expect(await resolveImapHost('127.0.0.1', true)).toBe('127.0.0.1');
    await expect(
      resolveImapHost('imap.example.invalid', false, 100, async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow('EMAIL_HOST_FORBIDDEN');
    await expect(
      resolveImapHost('imap.example.invalid', false, 100, async () => []),
    ).rejects.toThrow('EMAIL_HOST_FORBIDDEN');
    await expect(
      resolveImapHost('imap.example.invalid', false, 100, async () => {
        throw new Error('Sensitive DNS detail');
      }),
    ).rejects.toThrow('EMAIL_HOST_UNAVAILABLE');
    await expect(
      resolveImapHost(
        'imap.example.invalid',
        false,
        5,
        () => new Promise(() => {}),
      ),
    ).rejects.toThrow('EMAIL_HOST_UNAVAILABLE');
  });
});
describe('email normalization', () => {
  it('cleans tracking without following redirects or discarding job identity', () => {
    expect(
      cleanEmailLink(
        'https://example.invalid/job?jk=abc&utm_source=email&trk=alert&trackingId=x&refId=y#details',
      ),
    ).toBe('https://example.invalid/job?jk=abc');
    expect(
      cleanEmailLink(
        'https://track.example.invalid/click?url=' +
          encodeURIComponent(
            'https://example.invalid/job?jk=abc&utm_medium=email',
          ),
      ),
    ).toBe('https://example.invalid/job?jk=abc');
    expect(
      cleanEmailLink('https://example.invalid/job?jk=abc&amp;utm_source=email'),
    ).toBe('https://example.invalid/job?jk=abc');
    for (const url of [
      'not a link',
      'javascript:alert(1)',
      'file:///secret',
      'https://name:password@example.invalid/job',
      'http://127.0.0.1/job',
      'http://[::1]/job',
      'http://localhost/job',
      'http://intranet.localhost/job',
      'http://2130706433/job',
    ])
      expect(cleanEmailLink(url)).toBeNull();
  });
  it('excludes script, style and image tracking URLs from grounded links', () => {
    expect(
      emailLinks(
        '',
        '<script>fetch("https://bad.example.invalid/script")</script><style>background:url(https://bad.example.invalid/style)</style><img src="https://bad.example.invalid/pixel"><a href="https://example.invalid/job">Job</a>',
      ),
    ).toEqual(['https://example.invalid/job']);
  });
  it('strips HTML, contacts and raw URL tokens from model text while collecting grounded links', () => {
    const text = cleanEmailText(
      'Call +33123456789 or 0612345678; private@example.invalid https://example.invalid/job?token=private',
      '',
    );
    expect(text).not.toContain('private');
    expect(text).not.toContain('0612345678');
    expect(text).not.toContain('+33123456789');
    expect(cleanEmailText('', '<script>bad()</script><p>Engineer</p>')).toBe(
      'Engineer',
    );
    expect(
      emailLinks(
        'See https://example.invalid/job?utm_source=email.',
        '<a href="https://example.invalid/job?trk=test">Role</a>',
      ),
    ).toEqual(['https://example.invalid/job']);
    expect(
      emailLinks(
        Array.from(
          { length: 210 },
          (_, i) => 'https://example.invalid/job/' + i,
        ).join(' '),
        '',
      ),
    ).toHaveLength(200);
  });
  it('yields cached normalized offers before reporting a partial-source warning', async () => {
    const source = new EmailAlertSource();
    const ctx: SourceContext = {
      companies: [],
      credentials: {},
      maxPages: 1,
      get: async () => null,
    };
    expect(source.isConfigured(ctx)).toBe(false);
    await expect(source.fetch(criteria, ctx).next()).rejects.toThrow(
      'SOURCE_NOT_CONFIGURED',
    );
    ctx.email = { configured: true, read: async () => ({ offers: [offer] }) };
    expect(source.isConfigured(ctx)).toBe(true);
    const values = [];
    for await (const raw of source.fetch(criteria, ctx))
      values.push(source.normalize(raw));
    expect(values).toEqual([offer]);
    expect(() =>
      source.normalize({
        value: { ...offer, sourceId: 'greenhouse' },
        company: '',
        token: '',
        country: 'ZZ',
      }),
    ).toThrow('EMAIL_INVALID_OFFER');
    ctx.email = {
      configured: true,
      read: async () => ({ offers: [offer], warning: 'EMAIL_MESSAGE_LIMIT' }),
    };
    const stream = source.fetch(criteria, ctx);
    expect((await stream.next()).done).toBe(false);
    await expect(stream.next()).rejects.toThrow('EMAIL_MESSAGE_LIMIT');
  });
});
