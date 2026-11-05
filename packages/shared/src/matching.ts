import type { SearchCriteria, NormalizedJobOffer } from './index.ts';
import type { FilterNote } from './jobs.ts';
const normalize = (v: string) =>
  v
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim();
export function hardFilter(
  criteria: SearchCriteria,
  offer: NormalizedJobOffer,
): { passed: boolean; reasons: FilterNote[]; warnings: FilterNote[] } {
  const reasons: FilterNote[] = [],
    warnings: FilterNote[] = [];
  const text = ' ' + normalize(offer.title + ' ' + offer.description) + ' ';
  const contains = (word: string) => {
    const value = normalize(word);
    return !!value && text.includes(' ' + value + ' ');
  };
  if (criteria.excludeKeywords.some(contains)) reasons.push('excluded_keyword');
  if (criteria.includeKeywords.some((v) => normalize(v) && !contains(v)))
    reasons.push('missing_keyword');
  if (criteria.contractTypes.length) {
    if (offer.contractType === 'unknown') warnings.push('contract_unknown');
    else if (!criteria.contractTypes.includes(offer.contractType))
      reasons.push('contract');
  }
  if (criteria.remote.length) {
    if (offer.remote === 'unknown') warnings.push('remote_unknown');
    else if (!criteria.remote.includes(offer.remote)) reasons.push('remote');
  }
  if (criteria.locations.length) {
    const country = offer.location.country.toUpperCase();
    const knownCountry = country !== 'ZZ';
    const compatible = criteria.locations.filter(
      (l) =>
        !knownCountry ||
        l.country.toUpperCase() === 'ZZ' ||
        l.country.toUpperCase() === country,
    );
    if (!compatible.length) reasons.push('location');
    else if (
      !knownCountry ||
      (!offer.location.city && !offer.location.postalCode)
    )
      warnings.push('location_unknown');
    else if (
      !(offer.remote === 'full' && criteria.remote.includes('full')) &&
      !compatible.some(
        (l) =>
          (!l.city && !l.postalCode) ||
          (!!l.city && normalize(l.city) === normalize(offer.location.city)) ||
          (!!l.postalCode && l.postalCode === offer.location.postalCode),
      )
    ) {
      if ((criteria.radiusKm ?? 0) > 0) warnings.push('distance_unverified');
      else reasons.push('location');
    }
  }
  if (criteria.salaryMin !== undefined) {
    if (offer.salaryMax === null && offer.salaryMin === null)
      warnings.push('salary_unknown');
    else if (offer.salaryCurrency !== 'EUR')
      warnings.push('salary_currency_unknown');
    else if (offer.salaryMax !== null && offer.salaryMax < criteria.salaryMin)
      reasons.push('salary');
    else if (
      offer.salaryMax === null &&
      (offer.salaryMin ?? 0) < criteria.salaryMin
    )
      warnings.push('salary_unknown');
  }
  return { passed: reasons.length === 0, reasons, warnings };
}
