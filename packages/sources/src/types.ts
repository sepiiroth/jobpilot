import { z } from 'zod';
import type { SearchCriteria, NormalizedJobOffer } from '@jobpilot/shared';
export interface RawJobOffer {
  value: unknown;
  company: string;
  token: string;
  country: string;
}
export interface SourceContext {
  companies: Array<{ name: string; atsType: string; atsToken: string }>;
  credentials: Record<string, string>;
  maxPages: number;
  get: (url: URL, source: string) => Promise<unknown>;
}
export interface JobSource {
  readonly id: 'adzuna' | 'greenhouse' | 'lever' | 'ashby';
  readonly displayName: string;
  readonly requestsPerSecond: number;
  isConfigured(ctx: SourceContext): boolean;
  fetch(
    criteria: SearchCriteria,
    ctx: SourceContext,
  ): AsyncIterable<RawJobOffer>;
  normalize(raw: RawJobOffer): NormalizedJobOffer;
}
export class SourceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const rawId = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform(String);
