import { z } from 'zod';
import { CryptoService } from '@jobpilot/shared/crypto';
import type { LlmEnvironment } from './config.ts';
import { LlmError } from './errors.ts';
import type {
  LlmProvider,
  ProviderFactory,
  Prompt,
  LlmResult,
  ProviderConfiguration,
} from './provider.ts';
import { LlmRepository } from './repository.ts';
export class LlmService {
  constructor(
    private readonly repository: LlmRepository,
    private readonly crypto: CryptoService,
    readonly config: LlmEnvironment,
    private readonly factory: ProviderFactory,
  ) {}
  summary(userId: string) {
    return this.repository.summary(userId, this.config.LLM_MONTHLY_TOKEN_LIMIT);
  }
  async selection(
    userId: string,
    operation: 'generation' | 'scoring' | 'embedding',
  ) {
    const settings = await this.repository.settings(userId, this.config);
    const provider =
      operation === 'embedding'
        ? settings.embeddingProvider
        : settings.llmProvider;
    const model =
      operation === 'embedding'
        ? settings.embeddingModel
        : operation === 'generation'
          ? settings.generationModel
          : settings.scoringModel;
    const config: ProviderConfiguration = { provider, model };
    if (provider === 'ollama') config.baseUrl = settings.ollamaBaseUrl;
    else {
      const kind =
        (operation === 'embedding' ? 'embedding_' : 'llm_') + provider;
      const secret = await this.repository.secret(userId, kind);
      if (!secret) throw new LlmError('LLM_NOT_CONFIGURED');
      config.apiKey = this.crypto.decrypt(
        {
          ...secret,
          ciphertext: Buffer.from(secret.ciphertext),
          iv: Buffer.from(secret.iv),
          authTag: Buffer.from(secret.authTag),
        },
        `${userId}:${kind}`,
      );
    }
    return config;
  }
  async generateStructured<T>(
    userId: string,
    purpose: string,
    prompt: Prompt,
    schema: z.ZodType<T>,
    operation: 'generation' | 'scoring' = 'generation',
  ): Promise<T> {
    const selected = await this.selection(userId, operation);
    const schemaBytes = Buffer.byteLength(
      JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' })),
    );
    return this.call(
      userId,
      purpose,
      selected,
      prompt.version,
      Buffer.byteLength(prompt.system + prompt.user) +
        schemaBytes +
        4096 +
        this.config.LLM_MAX_OUTPUT_TOKENS,
      async (provider, signal) => {
        const result = await provider.generateStructured(prompt, schema, {
          signal,
          maxOutputTokens: this.config.LLM_MAX_OUTPUT_TOKENS,
        });
        const parsed = schema.safeParse(result.value);
        if (!parsed.success) throw new LlmError('LLM_INVALID_OUTPUT');
        return { ...result, value: parsed.data };
      },
      'text',
      operation === 'scoring' ? 0 : this.config.LLM_MAX_RETRIES,
    );
  }
  async generateText(
    userId: string,
    purpose: string,
    prompt: Prompt,
  ): Promise<string> {
    const selected = await this.selection(userId, 'generation');
    return this.call(
      userId,
      purpose,
      selected,
      prompt.version,
      Buffer.byteLength(prompt.system + prompt.user) +
        4096 +
        this.config.LLM_MAX_OUTPUT_TOKENS,
      (provider, signal) =>
        provider.generateText(prompt, {
          signal,
          maxOutputTokens: this.config.LLM_MAX_OUTPUT_TOKENS,
        }),
      'text',
    );
  }
  async embed(
    userId: string,
    text: string,
    purpose = 'resume_embedding',
  ): Promise<{ embedding: number[]; provider: string; model: string }> {
    if (!text.trim() || Buffer.byteLength(text) > 100000)
      throw new LlmError('LLM_INVALID_OUTPUT');
    const selected = await this.selection(userId, 'embedding');
    const embedding = await this.call(
      userId,
      purpose,
      selected,
      null,
      Buffer.byteLength(text) + 1024,
      (provider, signal) => provider.embed(text, signal),
      'embedding',
    );
    const parsed = z
      .array(z.number().finite())
      .length(this.config.EMBEDDING_DIMENSIONS)
      .refine((v) => v.some((n) => n !== 0))
      .safeParse(embedding);
    if (!parsed.success) throw new LlmError('LLM_INVALID_OUTPUT');
    return {
      embedding: parsed.data,
      provider: selected.provider,
      model: selected.model,
    };
  }
  private async call<T>(
    userId: string,
    purpose: string,
    selected: ProviderConfiguration,
    version: string | null,
    reservation: number,
    run: (provider: LlmProvider, signal: AbortSignal) => Promise<LlmResult<T>>,
    operation: 'text' | 'embedding',
    maxRetries = this.config.LLM_MAX_RETRIES,
  ): Promise<T> {
    const provider = this.factory(selected, operation);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const record = await this.repository.reserve(
        userId,
        {
          purpose,
          provider: selected.provider,
          model: selected.model,
          tokens: reservation,
          promptVersion: version,
        },
        this.config.LLM_MONTHLY_TOKEN_LIMIT,
      );
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          run(provider, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new LlmError('LLM_TIMEOUT', true));
            }, this.config.LLM_TIMEOUT_MS);
          }),
        ]);
        const rate =
          this.config.LLM_PRICING_JSON[
            `${selected.provider}:${selected.model}`
          ];
        const cost =
          rate && result.usage.tokensIn >= 0 && result.usage.tokensOut >= 0
            ? (result.usage.tokensIn * rate.inputPerMillion +
                result.usage.tokensOut * rate.outputPerMillion) /
              1_000_000
            : null;
        await this.repository.settle(userId, record.id, result.usage, cost);
        return result.value;
      } catch (error) {
        await this.repository.settle(userId, record.id, null, null);
        const safe =
          error instanceof LlmError ? error : new LlmError('LLM_UNAVAILABLE');
        if (!safe.retryable || attempt === maxRetries) throw safe;
      } finally {
        if (timer) clearTimeout(timer);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
    throw new LlmError('LLM_UNAVAILABLE');
  }
}
