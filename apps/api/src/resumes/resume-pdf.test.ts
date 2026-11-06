import { it, expect } from 'vitest';
import { extractText } from 'unpdf';
import { renderResumePdf } from './resume-pdf.ts';
import { syntheticResume } from './__fixtures__/resume.ts';
it('exports selectable French text in reading order with all resume sections', async () => {
  const buffer = await renderResumePdf(syntheticResume);
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  const result = await extractText(new Uint8Array(buffer), {
    mergePages: true,
  });
  for (const value of [
    'Camille Exemple',
    'Entreprise Exemple',
    'Développeuse TypeScript',
    'École Exemple',
    'TypeScript',
    'Français',
    'Projet de démonstration',
    'https://example.invalid/demo',
  ])
    expect(result.text).toContain(value);
  expect(result.text.indexOf('Expériences')).toBeLessThan(
    result.text.indexOf('Formation'),
  );
  expect(result.text.indexOf('Formation')).toBeLessThan(
    result.text.indexOf('Compétences'),
  );
  expect(result.totalPages).toBe(1);
});
it('wraps long resumes without dropping their final entries', async () => {
  const data = {
    ...syntheticResume,
    work: Array.from({ length: 30 }, (_, i) => ({
      ...syntheticResume.work[0]!,
      name: `Synthetic employer ${i}`,
      summary: 'Parcours de démonstration. '.repeat(10),
    })),
  };
  const result = await extractText(
    new Uint8Array(await renderResumePdf(data)),
    { mergePages: true },
  );
  expect(result.totalPages).toBeGreaterThan(1);
  expect(result.text).toContain('Synthetic employer 29');
  expect(result.text).toContain('Projet de démonstration');
});
it('uses English section labels and present-tense date labels without translating source facts', async () => {
  const data = structuredClone(syntheticResume);
  delete data.work[0]!.endDate;
  const result = await extractText(
    new Uint8Array(await renderResumePdf(data, 'en')),
    { mergePages: true },
  );
  for (const label of [
    'Profile',
    'Experience',
    'Education',
    'Skills',
    'Languages',
    'Projects',
    'Present',
    'Entreprise Exemple',
  ])
    expect(result.text).toContain(label);
});
