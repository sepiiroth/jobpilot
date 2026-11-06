import { z } from 'zod';
import {
  normalizedJobOfferSchema,
  type SearchCriteria,
} from '@jobpilot/shared';
import { cleanText } from './normalize.ts';
import {
  SourceError,
  type JobSource,
  type RawJobOffer,
  type SourceContext,
} from './types.ts';

const offerSchema = z.object({
  id: z.string().min(1),
  intitule: z.string().min(1),
  description: z.string(),
  entreprise: z.object({ nom: z.string().optional() }).optional(),
  lieuTravail: z
    .object({
      libelle: z.string().optional(),
      codePostal: z.string().optional(),
      latitude: z.string().optional(),
      longitude: z.string().optional(),
    })
    .optional(),
  origineOffre: z.object({ urlOrigine: z.url().optional() }).optional(),
  typeContrat: z.string().optional(),
  dateCreation: z.iso.datetime({ offset: true }).optional(),
});
/** Deliberately unavailable until API access and current contract are approved. */
export class FranceTravailSource implements JobSource {
  readonly id = 'france_travail';
  readonly displayName = 'France Travail';
  readonly requestsPerSecond = 1;
  isConfigured(_ctx: SourceContext) {
    void _ctx;
    return false;
  }
  async *fetch(
    _criteria: SearchCriteria,
    _ctx: SourceContext,
  ): AsyncGenerator<RawJobOffer, void, unknown> {
    void _criteria;
    void _ctx;
    throw new SourceError('SOURCE_DISABLED');
  }
  normalize(raw: RawJobOffer) {
    const value = offerSchema.parse(raw.value);
    const url = new URL(
      value.origineOffre?.urlOrigine ??
        `https://candidat.francetravail.fr/offres/recherche/detail/${encodeURIComponent(value.id)}`,
    );
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new SourceError('SOURCE_INVALID_OFFER');
    for (const key of [...url.searchParams.keys()])
      if (key.startsWith('utm_')) url.searchParams.delete(key);
    return normalizedJobOfferSchema.parse({
      sourceId: this.id,
      externalId: value.id,
      title: cleanText(value.intitule),
      company: cleanText(value.entreprise?.nom ?? raw.company),
      url: url.href,
      location: {
        city: cleanText(value.lieuTravail?.libelle ?? ''),
        postalCode: value.lieuTravail?.codePostal,
        country: 'FR',
      },
      remote: 'unknown',
      contractType:
        (
          {
            CDI: 'permanent',
            CDD: 'fixed_term',
            MIS: 'temporary',
            SAI: 'temporary',
          } as Record<string, string>
        )[value.typeContrat ?? ''] ?? 'unknown',
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      description: cleanText(value.description),
      publishedAt: value.dateCreation ?? null,
      fetchedAt: new Date().toISOString(),
    });
  }
}
