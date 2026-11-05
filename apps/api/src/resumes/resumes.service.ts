import {
  resumeInputSchema,
  resumeRecordSchema,
} from '@jobpilot/shared/profile';
import { ApiError } from '../common/errors.ts';
import { ResumesRepository } from './resumes.repository.ts';
export class ResumesService {
  constructor(private readonly repository: ResumesRepository) {}
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
    return resumeRecordSchema.parse(value);
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
