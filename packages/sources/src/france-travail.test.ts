import { FranceTravailSource } from './france-travail.ts';
import { expect, it } from 'vitest';
it('keeps France Travail disabled and never performs HTTP calls', async () => {
  const source = new FranceTravailSource();
  const ctx = {
    companies: [],
    credentials: {},
    maxPages: 1,
    get: async () => {
      throw new Error('Network forbidden');
    },
  };
  expect(source.isConfigured(ctx)).toBe(false);
  await expect(source.fetch({} as never, ctx).next()).rejects.toThrow(
    'SOURCE_DISABLED',
  );
  const offer = source.normalize({
    company: 'Example company',
    token: '',
    country: 'FR',
    value: {
      id: 'demo-1',
      intitule: 'Engineer',
      description: '<p>Synthetic vacancy</p>',
      entreprise: { nom: 'Example company' },
      typeContrat: 'CDI',
    },
  });
  expect(offer.description).toBe('Synthetic vacancy');
  expect(offer.sourceId).toBe('france_travail');
});
