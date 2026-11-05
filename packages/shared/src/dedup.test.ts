import { describe, it, expect } from 'vitest';
import { computeDedupKey, normalizeText } from './dedup.js';
describe('deduplication', () => {
  it.each([
    'Développeur H/F',
    'DÉVELOPPEUR (F/H)',
    'developpeur!!!',
    '  Développeur  ',
  ])('normalizes %s', (title) => {
    expect(computeDedupKey(title, 'Société', 'Paris')).toBe(
      computeDedupKey('developpeur', 'societe', 'paris'),
    );
  });
  it('keeps distinct jobs separate', () => {
    expect(computeDedupKey('A', 'B', 'Paris')).not.toBe(
      computeDedupKey('A', 'B', 'Lyon'),
    );
  });
  it('collapses whitespace', () =>
    expect(normalizeText('  École   Paris ')).toBe('ecole paris'));
});
