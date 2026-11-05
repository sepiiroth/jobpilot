import { it, expect } from 'vitest';
import {
  resumeSchema,
  llmAnalysisSchema,
  normalizedJobOfferSchema,
  searchSchema,
} from './index.js';
it('accepts a minimal resume without inventing work history', () => {
  expect(resumeSchema.parse({ basics: { name: 'Synthetic' } }).work).toEqual(
    [],
  );
});
it('rejects malformed email and unsafe profile URLs', () => {
  expect(
    resumeSchema.safeParse({ basics: { name: 'Synthetic', email: 'invalid' } })
      .success,
  ).toBe(false);
  expect(
    resumeSchema.safeParse({
      basics: { name: 'Synthetic', url: 'javascript:alert(1)' },
    }).success,
  ).toBe(false);
});
it('requires bounded scores and exactly three strengths and concerns', () => {
  const analysis = {
    score: 90,
    strengths: ['a', 'b', 'c'],
    concerns: ['a', 'b', 'c'],
    missingSkills: [],
  };
  expect(llmAnalysisSchema.safeParse(analysis).success).toBe(true);
  expect(llmAnalysisSchema.safeParse({ ...analysis, score: 101 }).success).toBe(
    false,
  );
  expect(
    llmAnalysisSchema.safeParse({ ...analysis, strengths: [] }).success,
  ).toBe(false);
});
it('rejects incomplete searches and offers', () => {
  expect(searchSchema.safeParse({ name: 'Synthetic' }).success).toBe(false);
  expect(
    normalizedJobOfferSchema.safeParse({ title: 'Synthetic' }).success,
  ).toBe(false);
});
