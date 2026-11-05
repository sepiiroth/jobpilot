import { LlmService, resumeImportPrompt } from '@jobpilot/llm';
import { importProposalSchema } from '@jobpilot/shared/llm';
import { PdfExtractor } from './pdf-extractor.ts';
import { ResumeEmbeddings } from './resume-embeddings.ts';
import {
  resumeInputSchema,
  resumeRecordSchema,
} from '@jobpilot/shared/profile';
import { ApiError } from '../common/errors.ts';
import { ResumesRepository } from './resumes.repository.ts';
export class ResumesService {
  private readonly extractor = new PdfExtractor();
  constructor(
    private readonly repository: ResumesRepository,
    private readonly embeddings: ResumeEmbeddings,
    private readonly llm: LlmService,
  ) {}
  async proposePdf(userId: string, pdf: Buffer) {
    const text = await this.extractor.extract(pdf);
    return this.llm.generateStructured(
      userId,
      'resume_import',
      resumeImportPrompt(text),
      importProposalSchema,
    );
  }
  async reindex(userId: string, id: string) {
    await this.get(userId, id);
    await this.embeddings.refresh(userId, id);
    return this.get(userId, id);
  }
  async list(userId: string) {
    return (await this.repository.list(userId)).map((v) =>
      resumeRecordSchema.parse(v),
    );
  }
  async get(userId: string, id: string) {
    const value = await this.repository.find(userId, id);
    if (!value) throw new ApiError(404, 'NOT_FOUND', 'Resume not found');
    return resumeRecordSchema.parse(value);
  }
  async save(userId: string, id: string | undefined, input: unknown) {
    const parsed = resumeInputSchema.parse(input);
    const value = id
      ? await this.repository.update(userId, id, parsed)
      : await this.repository.create(userId, parsed);
    if (!value) throw new ApiError(404, 'NOT_FOUND', 'Resume not found');
    await this.embeddings.refresh(userId, value.id);
    return this.get(userId, value.id);
  }
  async delete(userId: string, id: string) {
    const result = await this.repository.delete(userId, id);
    if (result === 'missing')
      throw new ApiError(404, 'NOT_FOUND', 'Resume not found');
    if (result === 'in_use')
      throw new ApiError(
        409,
        'RESUME_IN_USE',
        'Remove linked searches before deleting this resume',
      );
    return { ok: true };
  }
}
