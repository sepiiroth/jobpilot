import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { SourceError } from '../types.ts';
export type Resolver = (
  host: string,
) => Promise<Array<{ address: string; family: number }>>;
const resolveAll: Resolver = (host) =>
  lookup(host, { all: true, verbatim: true });
function ipv4(address: string, allowPrivate: boolean) {
  const [a, b, c, d] = address.split('.').map(Number);
  if (
    [a, b, c, d].some(
      (n) => n === undefined || !Number.isInteger(n) || n < 0 || n > 255,
    )
  )
    return false;
  if (
    a === 0 ||
    a! >= 224 ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
    return false;
  const internal =
    a === 10 ||
    a === 127 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127);
  return !internal || allowPrivate;
}
export function allowedImapAddress(
  address: string,
  allowPrivate = false,
): boolean {
  if (isIP(address) === 4) return ipv4(address, allowPrivate);
  if (isIP(address) !== 6 || address.includes('%')) return false;
  const dotted = address.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  let value = address.toLowerCase();
  if (dotted) {
    const octets = dotted.split('.').map(Number);
    value =
      value.slice(0, -dotted.length) +
      ((octets[0]! << 8) + octets[1]!).toString(16) +
      ':' +
      ((octets[2]! << 8) + octets[3]!).toString(16);
  }
  const halves = value.split('::'),
    left = (halves[0] ?? '').split(':').filter(Boolean),
    right = (halves[1] ?? '').split(':').filter(Boolean);
  const groups = (
    halves.length === 2
      ? [
          ...left,
          ...Array<string>(8 - left.length - right.length).fill('0'),
          ...right,
        ]
      : left
  ).map((v) => parseInt(v, 16));
  if (groups.length !== 8) return false;
  if (groups.slice(0, 5).every((v) => v === 0) && groups[5] === 0xffff)
    return ipv4(
      [
        groups[6]! >> 8,
        groups[6]! & 255,
        groups[7]! >> 8,
        groups[7]! & 255,
      ].join('.'),
      allowPrivate,
    );
  if (groups.slice(0, 7).every((v) => v === 0) && groups[7] === 1)
    return allowPrivate;
  if ((groups[0]! & 0xfe00) === 0xfc00) return allowPrivate;
  return (
    groups[0]! >= 0x2000 &&
    groups[0]! <= 0x3fff &&
    groups[0] !== 0x2002 &&
    !(groups[0] === 0x2001 && (groups[1] === 0x0db8 || groups[1]! < 0x0200)) &&
    !(groups[0] === 0x3fff && (groups[1]! & 0xf000) === 0)
  );
}
export async function resolveImapHost(
  host: string,
  allowPrivate = false,
  timeoutMs = 15000,
  resolver: Resolver = resolveAll,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await Promise.race([
          resolver(host),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new SourceError('EMAIL_HOST_UNAVAILABLE')),
              timeoutMs,
            );
          }),
        ]);
    if (
      !records.length ||
      records.length > 32 ||
      records.some((r) => !allowedImapAddress(r.address, allowPrivate))
    )
      throw new SourceError('EMAIL_HOST_FORBIDDEN');
    return records[0]!.address;
  } catch (error) {
    throw error instanceof SourceError
      ? error
      : new SourceError('EMAIL_HOST_UNAVAILABLE');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
