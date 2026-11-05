import { createHash } from 'node:crypto';
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\b(?:h\s*[/\-]\s*f|f\s*[/\-]\s*h)\b/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function computeDedupKey(
  title: string,
  company: string,
  city: string,
): string {
  return createHash('sha256')
    .update([title, company, city].map(normalizeText).join(''))
    .digest('hex');
}
