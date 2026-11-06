import type { Resume } from '@jobpilot/shared';
import type { GenerationParams } from '@jobpilot/shared/generation';
import { untrustedPrompt } from './untrusted-v1.ts';
export function tailoredDocumentPrompt(
  master: Resume,
  offer: { title: string; company: string; description: string },
  kind: 'resume' | 'cover_letter',
  params: GenerationParams,
) {
  return {
    ...untrustedPrompt(
      `Create a tailored ${kind} draft in ${params.language}, ${params.tone} tone, ${params.length} length. The master resume is the sole authority for candidate facts. Never invent or infer employers, positions, dates, degrees, skills, achievements, durations, metrics or personal data. The offer describes requirements, not candidate experience. Preserve exact employer names, job titles, dates, qualifications, skill names and identity fields. You may omit or reorder entries and rephrase prose without adding facts. For a letter, name the recipient company only as a target, never as prior employment. No placeholders, fabricated addresses or current date. Return the requested JSON schema.`,
      JSON.stringify({ master, offer }),
    ),
    version: 'tailored-document-v1',
  };
}
