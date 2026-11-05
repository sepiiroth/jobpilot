import { z } from 'zod';
import type { PrismaClient } from './generated/client.ts';
const id = z.uuid();
const vector = z
  .array(z.number().finite())
  .length(1024)
  .refine(
    (v) => v.some((n) => n !== 0),
    'Cosine similarity requires a nonzero vector',
  );
function encode(value: number[]): string {
  return JSON.stringify(vector.parse(value));
}
export class VectorRepository {
  private readonly db: PrismaClient;
  constructor(db: PrismaClient) {
    this.db = db;
  }
  async offerSimilarities(
    userId: string,
    resumeId: string,
    profile: string,
    offerIds: string[],
  ): Promise<Array<{ id: string; similarity: number }>> {
    if (!offerIds.length) return [];
    return this.db
      .$queryRaw`SELECT j.id, 1-(e.embedding <=> r.embedding) AS similarity FROM offer_embeddings e JOIN job_offers j ON j.id=e."jobOfferId" JOIN resumes r ON r.id=${resumeId}::uuid AND r."userId"=e."userId" WHERE e."userId"=${userId}::uuid AND e."profileKey"=${profile} AND e."contentHash"=j."contentHash" AND e.status='ready' AND e.embedding IS NOT NULL AND r.embedding IS NOT NULL AND r."embeddingStatus"='ready' AND r."embeddingProvider"=e.provider AND r."embeddingModel"=e.model AND j.id=ANY(${offerIds}::uuid[])`;
  }
  async setResumeEmbedding(
    userId: string,
    resumeId: string,
    embedding: number[],
  ): Promise<void> {
    id.parse(userId);
    id.parse(resumeId);
    const count = await this.db
      .$executeRaw`UPDATE resumes SET embedding = ${encode(embedding)}::vector WHERE id = ${resumeId}::uuid AND "userId" = ${userId}::uuid`;
    if (count !== 1) throw new Error('Resume not found');
  }
  async setJobEmbedding(
    jobOfferId: string,
    embedding: number[],
  ): Promise<void> {
    id.parse(jobOfferId);
    const count = await this.db
      .$executeRaw`UPDATE job_offers SET embedding = ${encode(embedding)}::vector WHERE id = ${jobOfferId}::uuid`;
    if (count !== 1) throw new Error('Job offer not found');
  }
  async findNearest(
    userId: string,
    embedding: number[],
    limit = 30,
  ): Promise<Array<{ id: string; similarity: number }>> {
    id.parse(userId);
    z.number().int().min(1).max(1000).parse(limit);
    const value = encode(embedding);
    return this.db
      .$queryRaw`SELECT offers.id, 1 - (offers.embedding <=> ${value}::vector) AS similarity FROM job_offers offers WHERE offers.embedding IS NOT NULL AND EXISTS (SELECT 1 FROM user_job_matches matches WHERE matches."jobOfferId" = offers.id AND matches."userId" = ${userId}::uuid AND matches.status <> 'ignored') ORDER BY offers.embedding <=> ${value}::vector LIMIT ${limit}`;
  }
}
