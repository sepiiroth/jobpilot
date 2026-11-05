import { untrustedPrompt } from './untrusted-v1.ts';
export const importPromptVersion = 'resume-import-v1';
export function resumeImportPrompt(text: string) {
  return {
    ...untrustedPrompt(
      'Extract a structured JSON Resume from the provided resume text. Preserve exact names, employers, qualifications, dates and skills. Never add experience or infer missing facts. Use only facts explicitly present. Omit absent optional fields; use empty arrays for absent sections. Use YYYY, YYYY-MM or YYYY-MM-DD dates only when explicit. Put extraction uncertainties in warnings, in French. Preserve the original language of resume content. A human will review and edit this proposal before saving.',
      text,
    ),
    version: importPromptVersion,
  };
}
