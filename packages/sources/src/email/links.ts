import sanitizeHtml from 'sanitize-html';
import { allowedImapAddress } from './network.ts';
import { cleanText } from '../normalize.ts';
const tracking = new Set([
  'trk',
  'trkemail',
  'trackingid',
  'refid',
  'lipi',
  'midtoken',
  'midsig',
  'from',
  'fromemail',
  'campaign',
  'campaignid',
  'mc_cid',
  'mc_eid',
  'gclid',
  'fbclid',
  'msclkid',
  'igshid',
]);
export function cleanEmailLink(value: string): string | null {
  try {
    let url = new URL(value.replace(/&amp;/gi, '&'));
    for (let i = 0; i < 3; i++) {
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return null;
      const target = ['url', 'redirect', 'redirecturl', 'target']
        .map((key) => url.searchParams.get(key))
        .find((v) => v && /^https?:\/\//i.test(v));
      if (!target) break;
      url = new URL(target);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      (/^\d/.test(host) && !host.includes('.')) ||
      (host.includes(':') && !allowedImapAddress(host)) ||
      (/^\d+\.\d+\.\d+\.\d+$/.test(host) && !allowedImapAddress(host))
    )
      return null;
    for (const key of [...url.searchParams.keys()])
      if (
        key.toLowerCase().startsWith('utm_') ||
        tracking.has(key.toLowerCase())
      )
        url.searchParams.delete(key);
    url.hash = '';
    const cleaned = url.toString();
    return cleaned.length <= 4096 ? cleaned : null;
  } catch {
    return null;
  }
}
export function emailLinks(text: string, html: string): string[] {
  const found = new Set<string>();
  const visibleHtml = sanitizeHtml(html, {
    allowedTags: ['a'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https'],
  });
  for (const match of (text + '\n' + visibleHtml).matchAll(
    /https?:\/\/[^\s<>"']+/gi,
  )) {
    const value = cleanEmailLink(match[0].replace(/[),.;]+$/, ''));
    if (value) found.add(value);
    if (found.size >= 200) break;
  }
  return [...found];
}
export function cleanEmailText(text: string, html: string) {
  return cleanText(text || html)
    .replace(/https?:\/\/[^\s<>]+/gi, '[link]')
    .replace(/(?<!\w)0[1-9](?:[ .-]?\d{2}){4}(?!\w)/g, '[phone removed]');
}
