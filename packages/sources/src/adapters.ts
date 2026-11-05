import { z } from 'zod';
import {
  normalizedJobOfferSchema,
  type SearchCriteria,
  type NormalizedJobOffer,
} from '@jobpilot/shared';
import {
  rawId,
  SourceError,
  type JobSource,
  type SourceContext,
  type RawJobOffer,
} from './types.ts';
import { cleanText, countryCode, contract, remote } from './normalize.ts';
const text = z.string();
const optionalText = text.nullish();
function url(value: string) {
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
    throw new SourceError('SOURCE_INVALID_OFFER');
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith('utm_')) u.searchParams.delete(key);
  return u.href;
}
function base(
  sourceId: string,
  externalId: string,
  title: string,
  company: string,
  link: string,
  city: string,
  country: string,
  description: string,
  published: string | number | null | undefined,
): NormalizedJobOffer {
  const date =
    published === null || published === undefined ? null : new Date(published);
  return normalizedJobOfferSchema.parse({
    sourceId,
    externalId,
    title: cleanText(title),
    company: cleanText(company),
    url: url(link),
    location: { city: cleanText(city), country: countryCode(country) },
    remote: 'unknown',
    contractType: 'unknown',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    description: cleanText(description),
    publishedAt:
      date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    fetchedAt: new Date().toISOString(),
  });
}
export class AdzunaSource implements JobSource {
  readonly id = 'adzuna';
  readonly displayName = 'Adzuna';
  readonly requestsPerSecond = 0.25;
  isConfigured(ctx: SourceContext) {
    return !!ctx.credentials.adzuna_app_id && !!ctx.credentials.adzuna_app_key;
  }
  async *fetch(criteria: SearchCriteria, ctx: SourceContext) {
    for (const title of criteria.titles)
      for (const location of criteria.locations.length
        ? criteria.locations
        : [{ city: '', country: 'FR' }]) {
        const country = location.country.toLowerCase();
        if (
          ![
            'fr',
            'gb',
            'us',
            'de',
            'nl',
            'au',
            'ca',
            'pl',
            'at',
            'nz',
            'in',
            'sg',
            'za',
            'br',
            'it',
            'es',
          ].includes(country)
        )
          throw new SourceError('SOURCE_COUNTRY_UNSUPPORTED');
        for (let page = 1; page <= ctx.maxPages; page++) {
          const u = new URL(
            `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`,
          );
          u.searchParams.set('app_id', ctx.credentials.adzuna_app_id ?? '');
          u.searchParams.set('app_key', ctx.credentials.adzuna_app_key ?? '');
          u.searchParams.set('what', title);
          u.searchParams.set('results_per_page', '50');
          u.searchParams.set('content-type', 'application/json');
          if (location.city) u.searchParams.set('where', location.city);
          if (criteria.radiusKm !== undefined)
            u.searchParams.set('distance', String(criteria.radiusKm));
          const result = z
            .object({ results: z.array(z.unknown()) })
            .parse(await ctx.get(u, this.id));
          for (const value of result.results)
            yield { value, company: '', token: '', country };
          if (result.results.length < 50) break;
          if (page === ctx.maxPages)
            throw new SourceError('COLLECTION_PAGE_LIMIT');
        }
      }
  }
  normalize(raw: RawJobOffer) {
    const v = z
      .object({
        id: rawId,
        title: text,
        company: z.object({ display_name: text }),
        redirect_url: text,
        location: z.object({ display_name: text }),
        description: text,
        created: optionalText,
        contract_type: optionalText,
        salary_min: z.number().finite().nonnegative().nullish(),
        salary_max: z.number().finite().nonnegative().nullish(),
        salary_is_predicted: z.union([z.string(), z.number()]).optional(),
      })
      .parse(raw.value);
    const offer = base(
      this.id,
      v.id,
      v.title,
      v.company.display_name,
      v.redirect_url,
      v.location.display_name.split(',')[0] ?? '',
      raw.country,
      v.description,
      v.created,
    );
    offer.contractType = contract(v.contract_type ?? '');
    if (String(v.salary_is_predicted ?? '0') === '0') {
      offer.salaryMin = v.salary_min ?? null;
      offer.salaryMax = v.salary_max ?? null;
      offer.salaryCurrency =
        (
          {
            gb: 'GBP',
            fr: 'EUR',
            de: 'EUR',
            us: 'USD',
            ca: 'CAD',
            au: 'AUD',
          } as Record<string, string>
        )[raw.country.toLowerCase()] ?? null;
    }
    return normalizedJobOfferSchema.parse(offer);
  }
}
export class GreenhouseSource implements JobSource {
  readonly id = 'greenhouse';
  readonly displayName = 'Greenhouse';
  readonly requestsPerSecond = 1;
  isConfigured(ctx: SourceContext) {
    return ctx.companies.some((c) => c.atsType === this.id);
  }
  async *fetch(_criteria: SearchCriteria, ctx: SourceContext) {
    for (const company of ctx.companies.filter((c) => c.atsType === this.id)) {
      const u = new URL(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.atsToken)}/jobs`,
      );
      u.searchParams.set('content', 'true');
      const result = z
        .object({ jobs: z.array(z.unknown()) })
        .parse(await ctx.get(u, this.id));
      for (const value of result.jobs)
        yield {
          value,
          company: company.name,
          token: company.atsToken,
          country: 'ZZ',
        };
    }
  }
  normalize(raw: RawJobOffer) {
    const v = z
      .object({
        id: rawId,
        title: text,
        absolute_url: text,
        location: z.object({ name: text }),
        content: optionalText,
        updated_at: optionalText,
        first_published: optionalText,
      })
      .parse(raw.value);
    const result = base(
      this.id,
      raw.token + ':' + v.id,
      v.title,
      raw.company,
      v.absolute_url,
      v.location.name,
      raw.country,
      v.content ?? '',
      v.first_published,
    );
    result.remote = remote(v.location.name);
    return result;
  }
}
export class LeverSource implements JobSource {
  readonly id = 'lever';
  readonly displayName = 'Lever';
  readonly requestsPerSecond = 1;
  isConfigured(ctx: SourceContext) {
    return ctx.companies.some((c) => c.atsType === this.id);
  }
  async *fetch(_criteria: SearchCriteria, ctx: SourceContext) {
    for (const company of ctx.companies.filter((c) => c.atsType === this.id))
      for (let page = 0; page < ctx.maxPages; page++) {
        const u = new URL(
          `https://api.lever.co/v0/postings/${encodeURIComponent(company.atsToken)}`,
        );
        u.searchParams.set('mode', 'json');
        u.searchParams.set('limit', '100');
        u.searchParams.set('skip', String(page * 100));
        const jobs = z.array(z.unknown()).parse(await ctx.get(u, this.id));
        for (const value of jobs)
          yield {
            value,
            company: company.name,
            token: company.atsToken,
            country: 'ZZ',
          };
        if (jobs.length < 100) break;
        if (page === ctx.maxPages - 1)
          throw new SourceError('COLLECTION_PAGE_LIMIT');
      }
  }
  normalize(raw: RawJobOffer) {
    const v = z
      .object({
        id: rawId,
        text: text,
        hostedUrl: text,
        categories: z
          .object({ location: optionalText, commitment: optionalText })
          .optional(),
        descriptionPlain: optionalText,
        description: optionalText,
        additionalPlain: optionalText,
        lists: z
          .array(z.object({ text: optionalText, content: optionalText }))
          .optional(),
        createdAt: z.number().nullish(),
        workplaceType: optionalText,
        salaryRange: z
          .object({
            min: z.number().nonnegative().nullish(),
            max: z.number().nonnegative().nullish(),
            currency: optionalText,
            interval: optionalText,
          })
          .nullish(),
      })
      .parse(raw.value);
    const result = base(
      this.id,
      raw.token + ':' + v.id,
      v.text,
      raw.company,
      v.hostedUrl,
      v.categories?.location ?? '',
      raw.country,
      [
        v.descriptionPlain ?? v.description ?? '',
        ...(v.lists ?? []).map(
          (l) => (l.text ?? '') + '\n' + (l.content ?? ''),
        ),
        v.additionalPlain ?? '',
      ].join('\n'),
      v.createdAt,
    );
    result.remote = remote(v.workplaceType ?? '');
    result.contractType = contract(v.categories?.commitment ?? '');
    if (
      v.salaryRange &&
      ['per-year', 'year', 'yearly'].includes(v.salaryRange.interval ?? '')
    ) {
      result.salaryMin = v.salaryRange.min ?? null;
      result.salaryMax = v.salaryRange.max ?? null;
      result.salaryCurrency = v.salaryRange.currency ?? null;
    }
    return normalizedJobOfferSchema.parse(result);
  }
}
export class AshbySource implements JobSource {
  readonly id = 'ashby';
  readonly displayName = 'Ashby';
  readonly requestsPerSecond = 1;
  isConfigured(ctx: SourceContext) {
    return ctx.companies.some((c) => c.atsType === this.id);
  }
  async *fetch(_criteria: SearchCriteria, ctx: SourceContext) {
    for (const company of ctx.companies.filter((c) => c.atsType === this.id)) {
      const u = new URL(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.atsToken)}`,
      );
      u.searchParams.set('includeCompensation', 'true');
      const result = z
        .object({ jobs: z.array(z.unknown()) })
        .parse(await ctx.get(u, this.id));
      for (const value of result.jobs) {
        if (
          typeof value === 'object' &&
          value !== null &&
          'isListed' in value &&
          value.isListed === false
        )
          continue;
        yield {
          value,
          company: company.name,
          token: company.atsToken,
          country: 'ZZ',
        };
      }
    }
  }
  normalize(raw: RawJobOffer) {
    const v = z
      .object({
        id: rawId.optional(),
        title: text,
        location: optionalText,
        jobUrl: text,
        descriptionPlain: optionalText,
        descriptionHtml: optionalText,
        publishedAt: optionalText,
        workplaceType: optionalText,
        isRemote: z.boolean().optional(),
        employmentType: optionalText,
        address: z
          .object({
            postalAddress: z
              .object({
                addressLocality: optionalText,
                addressCountry: optionalText,
                postalCode: optionalText,
              })
              .optional(),
          })
          .optional(),
      })
      .parse(raw.value);
    const location = v.address?.postalAddress;
    const result = base(
      this.id,
      raw.token + ':' + (v.id ?? new URL(v.jobUrl).pathname),
      v.title,
      raw.company,
      v.jobUrl,
      location?.addressLocality || v.location || '',
      location?.addressCountry ?? 'ZZ',
      v.descriptionPlain ?? v.descriptionHtml ?? '',
      v.publishedAt,
    );
    result.remote = remote(v.workplaceType ?? (v.isRemote ? 'remote' : ''));
    result.contractType = contract(v.employmentType ?? '');
    return result;
  }
}
export const jobSources: JobSource[] = [
  new AdzunaSource(),
  new GreenhouseSource(),
  new LeverSource(),
  new AshbySource(),
];
