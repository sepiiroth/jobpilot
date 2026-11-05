import { createHash } from 'node:crypto';
import { searchInputSchema } from '@jobpilot/shared/profile';
export const scoringKey = (
  search: unknown,
  revision: number,
  profile: string,
  provider: string,
  model: string,
  baseUrl: string,
) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        searchInputSchema.parse(search),
        revision,
        profile,
        provider,
        model,
        provider === 'ollama' ? baseUrl : '',
      ]),
    )
    .digest('hex');
export const resultKey = (context: string, contentHash: string) =>
  createHash('sha256')
    .update(context + ':' + contentHash)
    .digest('hex');

export const scoringOfferKey = (
  offer: import('@jobpilot/shared').NormalizedJobOffer,
) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        offer.title,
        offer.company,
        offer.description,
        offer.location,
        offer.remote,
        offer.contractType,
        offer.salaryMin,
        offer.salaryMax,
        offer.salaryCurrency,
      ]),
    )
    .digest('hex');
