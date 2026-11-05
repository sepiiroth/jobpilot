import {
  searchInputSchema,
  searchRecordSchema,
} from '@jobpilot/shared/profile';
import { ApiError } from '../common/errors.ts';
import { SearchesRepository } from './searches.repository.ts';
function record(
  value: NonNullable<Awaited<ReturnType<SearchesRepository['find']>>>,
) {
  return searchRecordSchema.parse({
    ...value,
    radiusKm: value.radiusKm ?? undefined,
    salaryMin: value.salaryMin?.toNumber(),
    seniority: value.seniority ?? undefined,
  });
}
export class SearchesService {
  constructor(private readonly repository: SearchesRepository) {}
  async list(userId: string) {
    return (await this.repository.list(userId)).map(record);
  }
  async get(userId: string, id: string) {
    const value = await this.repository.find(userId, id);
    if (!value) throw new ApiError(404, 'NOT_FOUND', 'Search not found');
    return record(value);
  }
  async save(userId: string, id: string | undefined, input: unknown) {
    const value = await this.repository.save(
      userId,
      id,
      searchInputSchema.parse(input),
    );
    if (!value)
      throw new ApiError(404, 'NOT_FOUND', 'Search or active resume not found');
    return record(value);
  }
  async delete(userId: string, id: string) {
    if (!(await this.repository.delete(userId, id)))
      throw new ApiError(404, 'NOT_FOUND', 'Search not found');
    return { ok: true };
  }
}
