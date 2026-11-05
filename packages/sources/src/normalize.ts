import sanitizeHtml from 'sanitize-html';
export function cleanText(value: string): string {
  const strip = (input: string) =>
    sanitizeHtml(input.replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, '\n'), {
      allowedTags: [],
      allowedAttributes: {},
    }).replace(
      /&(amp|lt|gt|quot);/g,
      (_match, key: string) =>
        (({ amp: '&', lt: '<', gt: '>', quot: '"' }) as Record<string, string>)[
          key
        ]!,
    );
  return strip(strip(value))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\+\d[\d ().-]{7,}\d/g, '[phone removed]')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .slice(0, 20000);
}
export function countryCode(value: string): string {
  const c = value.toUpperCase();
  return (
    (
      {
        USA: 'US',
        UK: 'GB',
        'UNITED STATES': 'US',
        'UNITED KINGDOM': 'GB',
        FRANCE: 'FR',
        GERMANY: 'DE',
        SPAIN: 'ES',
        CANADA: 'CA',
      } as Record<string, string>
    )[c] ?? (/^[A-Z]{2}$/.test(c) ? c : 'ZZ')
  );
}
export function contract(
  value: string,
):
  | 'permanent'
  | 'fixed_term'
  | 'contract'
  | 'temporary'
  | 'internship'
  | 'apprenticeship'
  | 'unknown' {
  const c = value.toLowerCase();
  return (
    (
      {
        permanent: 'permanent',
        cdi: 'permanent',
        cdd: 'fixed_term',
        contract: 'contract',
        contractor: 'contract',
        temporary: 'temporary',
        internship: 'internship',
        stage: 'internship',
        apprenticeship: 'apprenticeship',
      } as const
    )[c as 'permanent'] ?? 'unknown'
  );
}
export function remote(value: string): 'none' | 'hybrid' | 'full' | 'unknown' {
  const c = value.toLowerCase();
  if (c === 'hybrid') return 'hybrid';
  if (c === 'remote' || c.startsWith('remote -') || c === 'full') return 'full';
  if (['onsite', 'on-site', 'on site'].includes(c)) return 'none';
  return 'unknown';
}
