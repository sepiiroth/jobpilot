import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.ts';
import { z } from 'zod';
export { PrismaClient, Prisma } from './generated/client.ts';
export function createDatabaseClient(
  url: string = process.env.DATABASE_URL ?? '',
): PrismaClient {
  z.url()
    .refine((v) => ['postgres:', 'postgresql:'].includes(new URL(v).protocol))
    .parse(url);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
export { VectorRepository } from './vector-repository.ts';
export {
  CollectionRepository,
  CollectionConflict,
  embeddingProfile,
  offerContentHash,
} from './collection-repository.ts';
