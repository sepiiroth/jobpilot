import { writeFile } from 'node:fs/promises';
import { renderResumePdf } from '../src/resumes/resume-pdf.ts';
import { syntheticResume } from '../src/resumes/__fixtures__/resume.ts';
const target = process.argv[2];
if (!target)
  throw new Error('Pass an output PDF path for the synthetic preview');
await writeFile(target, await renderResumePdf(syntheticResume));
console.log('Synthetic PDF written');
