import { it, expect } from 'vitest';
import {
  profileSettingsSchema,
  resumeInputSchema,
  searchInputSchema,
  secretInputSchema,
  companyInputSchema,
} from './profile.ts';
it('validates profile input without accepting ownership or plaintext IMAP passwords', () => {
  expect(
    resumeInputSchema.safeParse({
      title: 'Resume',
      data: { basics: { name: 'Example' } },
      userId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    profileSettingsSchema.safeParse({
      llmProvider: 'ollama',
      generationModel: 'local',
      scoringModel: 'local',
      embeddingProvider: 'ollama',
      embeddingModel: 'local',
      ollamaBaseUrl: 'file:///private',
      imap: null,
    }).success,
  ).toBe(false);
  expect(secretInputSchema.safeParse({ value: 'short' }).success).toBe(false);
  expect(
    companyInputSchema.safeParse({
      name: 'Example',
      atsType: 'lever',
      atsToken: '../../private',
    }).success,
  ).toBe(false);
  expect(
    searchInputSchema.safeParse({
      name: 'Search',
      resumeId: crypto.randomUUID(),
      titles: ['Developer'],
      remote: [],
      contractTypes: [],
      sources: ['france_travail'],
    }).success,
  ).toBe(false);
});
