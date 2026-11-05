import { normalizedJobOfferSchema } from '@jobpilot/shared';
import type { JobSource, SourceContext, RawJobOffer } from '../types.ts';
import type { SearchCriteria } from '@jobpilot/shared';
import { SourceError } from '../types.ts';
export class EmailAlertSource implements JobSource {
  readonly id = 'email';
  readonly displayName = 'Email alerts';
  readonly requestsPerSecond = 1;
  isConfigured(ctx: SourceContext) {
    return ctx.email?.configured === true;
  }
  async *fetch(
    _criteria: SearchCriteria,
    ctx: SourceContext,
  ): AsyncGenerator<RawJobOffer, void, unknown> {
    if (!ctx.email) throw new SourceError('SOURCE_NOT_CONFIGURED');
    const result = await ctx.email.read();
    for (const value of result.offers)
      yield { value, company: '', token: '', country: 'ZZ' };
    if (result.warning) throw new SourceError(result.warning);
  }
  normalize(raw: RawJobOffer) {
    const offer = normalizedJobOfferSchema.parse(raw.value);
    if (offer.sourceId !== 'email')
      throw new SourceError('EMAIL_INVALID_OFFER');
    return offer;
  }
}
