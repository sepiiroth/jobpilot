import { z } from 'zod';
import { LlmService, tailoredDocumentPrompt, fingerprint } from '@jobpilot/llm';
import { resumeSchema } from '@jobpilot/shared';
import {
  generationInputSchema,
  documentEditSchema,
  documentReviewSchema,
  type GenerationCost,
  type DocumentContent,
} from '@jobpilot/shared/generation';
import { ApiError } from '../common/errors.ts';
import { GenerationRepository } from './generation.repository.ts';
export class GenerationService {
  constructor(
    private readonly repository: GenerationRepository,
    private readonly llm: LlmService,
  ) {}
  list(userId: string, matchId: string, cursor?: string) {
    return this.repository.list(userId, matchId, cursor);
  }
  async get(userId: string, id: string) {
    return this.repository.serialize(await this.repository.find(userId, id));
  }
  async generate(userId: string, matchId: string, input: unknown) {
    const body = generationInputSchema.parse(input);
    const { master, offer } = await this.repository.context(
      userId,
      matchId,
      body.resumeId,
    );
    if (
      Buffer.byteLength(JSON.stringify({ master, offer: offer.description })) >
      150000
    )
      throw new ApiError(
        422,
        'GENERATION_INPUT_TOO_LARGE',
        'Input exceeds generation limit',
      );
    const schema: z.ZodType<DocumentContent> =
      body.kind === 'resume'
        ? z.strictObject({ kind: z.literal('resume'), data: resumeSchema })
        : z.strictObject({
            kind: z.literal('cover_letter'),
            text: z.string().trim().min(1).max(20000),
          });
    let cost: GenerationCost | undefined;
    const content = await this.llm.generateStructured(
      userId,
      'tailored_' + body.kind,
      tailoredDocumentPrompt(master, offer, body.kind, body.params),
      schema,
      'generation',
      (v) => {
        cost = v;
      },
    );
    if (!cost) throw new ApiError(503, 'LLM_UNAVAILABLE', 'Usage unavailable');
    return this.repository.serialize(
      await this.repository.append(
        userId,
        offer.id,
        body.resumeId,
        content,
        body.params,
        cost,
        fingerprint(master),
      ),
    );
  }
  async edit(userId: string, id: string, input: unknown) {
    const { content } = documentEditSchema.parse(input);
    const row = await this.repository.find(userId, id);
    const value = this.repository.serialize(row);
    if (content.kind !== value.kind)
      throw new ApiError(
        400,
        'INVALID_DOCUMENT_KIND',
        'Document kind cannot change',
      );
    return this.repository.serialize(
      await this.repository.append(
        userId,
        row.jobOfferId,
        row.resumeId,
        content,
        value.params,
        {
          usageId: null,
          uncertainAttempts: 0,
          provider: 'manual',
          model: 'manual',
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        },
        value.sourceFingerprint,
      ),
    );
  }
  async review(userId: string, id: string, input: unknown) {
    const value = documentReviewSchema.parse(input);
    return this.repository.serialize(
      await this.repository.approve(
        userId,
        id,
        value.sourceFingerprint,
        value.issueIds,
      ),
    );
  }
  async export(userId: string, id: string) {
    const value = await this.get(userId, id);
    if (value.integrity.blocked)
      throw new ApiError(
        409,
        'INTEGRITY_REVIEW_REQUIRED',
        'Review document before export',
      );
    return value;
  }
}
