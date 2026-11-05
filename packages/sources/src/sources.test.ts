import type { SearchCriteria } from '@jobpilot/shared';
import { it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import {
  jobSources,
  AdzunaSource,
  GreenhouseSource,
  LeverSource,
  AshbySource,
} from './adapters.ts';
import { SourceHttp, sourceTransport, type JsonTransport } from './http.ts';
import { cleanText, countryCode, contract, remote } from './normalize.ts';
import type { SourceContext, RawJobOffer } from './types.ts';
const load = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`./__fixtures__/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
const first = (name: string): unknown => {
  const payload = load(name) as { jobs?: unknown[]; results?: unknown[] };
  return Array.isArray(payload)
    ? payload[0]
    : (payload.jobs?.[0] ?? payload.results?.[0]);
};
const criteria: SearchCriteria = {
  name: 'Test search',
  resumeId: '019a4eaa-0000-7000-8000-000000000001',
  titles: ['Engineer'],
  locations: [],
  remote: [],
  contractTypes: [],
  includeKeywords: [],
  excludeKeywords: [],
  sources: ['adzuna' as const],
  isActive: true,
};
const context = (id: string, value: unknown): SourceContext => ({
  companies: [{ name: 'Example Company', atsType: id, atsToken: 'example' }],
  credentials: { adzuna_app_id: 'example-id', adzuna_app_key: 'example-key' },
  maxPages: 1,
  get: vi.fn(async () => value),
});
const raw = (name: string): RawJobOffer => ({
  value: first(name),
  company: 'Example Company',
  token: 'example',
  country: name === 'adzuna' ? 'gb' : 'ZZ',
});
it.each(jobSources.map((source) => [source.id, source] as const))(
  'normalizes the recorded anonymized %s response',
  async (id, source) => {
    const offer = source.normalize(raw(id));
    expect(offer.sourceId).toBe(id);
    expect(offer.externalId).toBeTruthy();
    expect(offer.url).toContain('example.invalid');
    expect(offer.description).not.toMatch(/<[^>]+>/);
    expect(offer.location.country).toHaveLength(2);
    const ctx = context(id, load(id));
    expect(source.isConfigured(ctx)).toBe(true);
    let count = 0;
    for await (const value of source.fetch(criteria, ctx)) {
      expect(value.value).toBeDefined();
      count++;
    }
    expect(count).toBe(1);
    expect(
      source.isConfigured({ ...ctx, companies: [], credentials: {} }),
    ).toBe(false);
  },
);
it('removes markup, scripts and recruiter contact details while decoding entities', () => {
  const text = cleanText(
    '<script>secret()</script><style>.x{}</style><p>R&amp;D&nbsp;Engineering</p><p>Contact alice@example.invalid or +33 6 00 00 00 00</p>',
  );
  expect(text).toContain('R&D');
  expect(text).not.toContain('secret');
  expect(text).not.toContain('alice@');
  expect(text).not.toContain('+33');
  expect(text).not.toContain('<p>');
});
it('does not guess contracts or countries from work hours and free text', () => {
  for (const name of [
    'permanent',
    'cdi',
    'cdd',
    'contract',
    'contractor',
    'temporary',
    'internship',
    'stage',
    'apprenticeship',
  ])
    expect(contract(name)).not.toBe('unknown');
  expect(contract('FullTime')).toBe('unknown');
  expect(countryCode('USA')).toBe('US');
  expect(countryCode('FR')).toBe('FR');
  expect(countryCode('European Union')).toBe('ZZ');
  expect(remote('Remote')).toBe('full');
  expect(remote('Remote - France')).toBe('full');
  expect(remote('hybrid')).toBe('hybrid');
  expect(remote('onsite')).toBe('none');
  expect(remote('Paris')).toBe('unknown');
});
it('keeps predicted salary and unknown currencies from becoming hard facts', () => {
  const source = new AdzunaSource();
  const value = first('adzuna') as Record<string, unknown>;
  expect(
    source.normalize({
      ...raw('adzuna'),
      value: { ...value, salary_is_predicted: 1 },
    }).salaryMin,
  ).toBeNull();
  expect(
    source.normalize({
      ...raw('adzuna'),
      country: 'xx',
      value: {
        ...value,
        created: 'invalid',
        salary_min: null,
        salary_max: null,
        contract_type: null,
        salary_is_predicted: undefined,
      },
    }).salaryCurrency,
  ).toBeNull();
  expect(source.normalize(raw('adzuna')).salaryCurrency).toBe('GBP');
});
it('handles absent ATS fields and explicit remote and annual salary fields', () => {
  const lever = new LeverSource();
  const value = first('lever') as Record<string, unknown>;
  const a = lever.normalize({
    ...raw('lever'),
    value: {
      ...value,
      categories: undefined,
      lists: undefined,
      descriptionPlain: undefined,
      description: '<p>Plain</p>',
      additionalPlain: 'Extra',
      createdAt: null,
      workplaceType: 'hybrid',
      salaryRange: {
        min: 40000,
        max: 50000,
        currency: 'EUR',
        interval: 'per-year',
      },
    },
  });
  expect(a.salaryMin).toBe(40000);
  expect(a.remote).toBe('hybrid');
  expect(a.publishedAt).toBeNull();
  expect(
    lever.normalize({
      ...raw('lever'),
      value: {
        ...value,
        categories: { location: 'Paris', commitment: 'contract' },
        salaryRange: { interval: 'hour', currency: 'EUR' },
      },
    }).salaryMin,
  ).toBeNull();
  const ashby = new AshbySource();
  expect(
    ashby.normalize({
      ...raw('ashby'),
      value: {
        title: 'Test',
        jobUrl: 'https://example.invalid/one',
        isRemote: true,
        descriptionHtml: '<p>Text</p>',
      },
    }).remote,
  ).toBe('full');
  expect(
    ashby.normalize({
      ...raw('ashby'),
      value: {
        title: 'Test',
        jobUrl: 'https://example.invalid/one',
        address: {
          postalAddress: { addressCountry: 'France', addressLocality: 'Paris' },
        },
        isRemote: false,
      },
    }).location.country,
  ).toBe('FR');
  const green = new GreenhouseSource();
  expect(
    green.normalize({
      ...raw('greenhouse'),
      value: {
        id: 1,
        title: 'T',
        absolute_url: 'https://example.invalid/1?utm_source=test',
        location: { name: 'Paris' },
        content: null,
        first_published: '2026-01-01',
      },
    }).url,
  ).not.toContain('utm_');
  expect(() =>
    green.normalize({
      ...raw('greenhouse'),
      value: {
        id: 1,
        title: 'T',
        absolute_url: 'javascript:alert(1)',
        location: { name: 'X' },
      },
    }),
  ).toThrow();
});
const gather = async (
  source: (typeof jobSources)[number],
  ctx: SourceContext,
  c = criteria,
) => {
  const values = [];
  for await (const value of source.fetch(c, ctx)) values.push(value);
  return values;
};
it('bounds pagination and validates source country selection', async () => {
  await expect(
    gather(
      new AdzunaSource(),
      context('adzuna', { results: Array(50).fill(first('adzuna')) }),
    ),
  ).rejects.toThrow('COLLECTION_PAGE_LIMIT');
  await expect(
    gather(
      new LeverSource(),
      context('lever', Array(100).fill(first('lever'))),
    ),
  ).rejects.toThrow('COLLECTION_PAGE_LIMIT');
  await expect(
    gather(new AdzunaSource(), context('adzuna', {}), {
      ...criteria,
      locations: [{ city: 'X', country: 'XX' }],
    }),
  ).rejects.toThrow('SOURCE_COUNTRY_UNSUPPORTED');
  const ctx = context('adzuna', load('adzuna'));
  await gather(new AdzunaSource(), ctx, {
    ...criteria,
    locations: [{ city: 'Paris', country: 'FR' }],
    radiusKm: 10,
  } as typeof criteria);
  expect(String(vi.mocked(ctx.get).mock.calls[0]?.[0])).toContain(
    'where=Paris',
  );
  expect(
    await gather(
      new AshbySource(),
      context('ashby', { jobs: [{ isListed: false }] }),
    ),
  ).toHaveLength(0);
  expect(
    await gather(new AshbySource(), { ...context('ashby', {}), companies: [] }),
  ).toHaveLength(0);
});
it('retries transient requests but refuses redirects, authentication failures and excess work', async () => {
  const permit = vi.fn(async () => {});
  const transport = vi
    .fn<JsonTransport>()
    .mockResolvedValueOnce({ status: 500, value: null })
    .mockResolvedValueOnce({ status: 200, value: { ok: true } });
  const http = new SourceHttp(
    'JobPilot/test (+https://example.invalid)',
    permit,
    10,
    transport,
  );
  expect(await http.get(new URL('https://api.lever.co/test'), 'lever')).toEqual(
    { ok: true },
  );
  expect(permit).toHaveBeenCalledTimes(2);
  await expect(
    http.get(new URL('http://127.0.0.1/test'), 'lever'),
  ).rejects.toThrow('SOURCE_ENDPOINT_FORBIDDEN');
  for (const status of [401, 403, 404])
    await expect(
      new SourceHttp('test', permit, 1, async () => ({
        status,
        value: null,
      })).get(new URL('https://api.lever.co/test'), 'lever'),
    ).rejects.toThrow();
  await expect(
    new SourceHttp('test', permit, 1, async () => ({
      status: 500,
      value: null,
    })).get(new URL('https://api.lever.co/test'), 'lever'),
  ).rejects.toThrow('COLLECTION_REQUEST_LIMIT');
  await expect(
    new SourceHttp('test', permit, 3, async () => {
      throw new Error('private URL');
    }).get(new URL('https://api.lever.co/test'), 'lever'),
  ).rejects.toThrow('SOURCE_UNAVAILABLE');
  await expect(
    new SourceHttp('test', permit, 3, async () => ({
      status: 429,
      value: null,
      retryAfterMs: 70000,
    })).get(new URL('https://api.lever.co/test'), 'lever'),
  ).rejects.toThrow('SOURCE_RATE_LIMITED');
  await expect(
    new SourceHttp('test', permit, 1, async () => {
      const { SourceError } = await import('./types.ts');
      throw new SourceError('SOURCE_INVALID_RESPONSE');
    }).get(new URL('https://api.lever.co/test'), 'lever'),
  ).rejects.toThrow('SOURCE_INVALID_RESPONSE');
});
const original = getGlobalDispatcher();
afterEach(() => setGlobalDispatcher(original));
it('reads bounded JSON responses with an in-memory HTTP mock only', async () => {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  const pool = agent.get('https://api.lever.co');
  pool
    .intercept({ path: '/ok', method: 'GET' })
    .reply(200, JSON.stringify({ ok: true }));
  expect(
    (
      await sourceTransport(
        new URL('https://api.lever.co/ok'),
        {},
        AbortSignal.timeout(1000),
      )
    ).value,
  ).toEqual({ ok: true });
  pool.intercept({ path: '/bad', method: 'GET' }).reply(200, 'not JSON');
  await expect(
    sourceTransport(
      new URL('https://api.lever.co/bad'),
      {},
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow('SOURCE_INVALID_RESPONSE');
  pool
    .intercept({ path: '/large', method: 'GET' })
    .reply(200, 'x'.repeat(4 * 1024 * 1024 + 1));
  await expect(
    sourceTransport(
      new URL('https://api.lever.co/large'),
      {},
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow('SOURCE_RESPONSE_TOO_LARGE');
  pool
    .intercept({ path: '/denied', method: 'GET' })
    .reply(429, 'limited', { headers: { 'retry-after': '1' } });
  expect(
    (
      await sourceTransport(
        new URL('https://api.lever.co/denied'),
        {},
        AbortSignal.timeout(1000),
      )
    ).retryAfterMs,
  ).toBe(1000);
  await agent.close();
});
