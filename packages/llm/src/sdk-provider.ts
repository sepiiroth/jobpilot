import {
  generateText,
  embed,
  Output,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  type LanguageModel,
  type EmbeddingModel,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createVoyage } from '@ai-sdk/voyage';
import type { z } from 'zod';
import type {
  LlmProvider,
  Prompt,
  CallOptions,
  ProviderConfiguration,
  ProviderFactory,
} from './provider.ts';
import type { LlmEnvironment } from './config.ts';
import { LlmError } from './errors.ts';
import { guardedFetch } from './fetch.ts';
// SDK warnings can contain provider metadata; only typed application errors leave this layer.
globalThis.AI_SDK_LOG_WARNINGS = false;
function failure(error: unknown, signal: AbortSignal): never {
  if (error instanceof LlmError) throw error;
  if (signal.aborted) throw new LlmError('LLM_TIMEOUT', true);
  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoOutputGeneratedError.isInstance(error)
  )
    throw new LlmError('LLM_INVALID_OUTPUT');
  const retryable =
    typeof error === 'object' &&
    error !== null &&
    'isRetryable' in error &&
    error.isRetryable === true;
  throw new LlmError('LLM_UNAVAILABLE', retryable);
}
class SdkProvider implements LlmProvider {
  constructor(
    private readonly language: LanguageModel | undefined,
    private readonly embedding: EmbeddingModel | undefined,
    private readonly options: Record<string, Record<string, number | boolean>>,
  ) {}
  async generateStructured<T>(
    prompt: Prompt,
    schema: z.ZodType<T>,
    options: CallOptions,
  ) {
    if (!this.language) throw new LlmError('LLM_NOT_CONFIGURED');
    try {
      const result = await generateText({
        model: this.language,
        system: prompt.system,
        prompt: prompt.user,
        output: Output.object({ schema }),
        maxOutputTokens: options.maxOutputTokens,
        maxRetries: 0,
        abortSignal: options.signal,
        providerOptions: this.options,
        experimental_telemetry: { isEnabled: false },
      });
      return {
        value: result.output,
        usage: {
          tokensIn: result.totalUsage.inputTokens ?? -1,
          tokensOut: result.totalUsage.outputTokens ?? -1,
        },
      };
    } catch (error) {
      return failure(error, options.signal);
    }
  }
  async generateText(prompt: Prompt, options: CallOptions) {
    if (!this.language) throw new LlmError('LLM_NOT_CONFIGURED');
    try {
      const result = await generateText({
        model: this.language,
        system: prompt.system,
        prompt: prompt.user,
        maxOutputTokens: options.maxOutputTokens,
        maxRetries: 0,
        abortSignal: options.signal,
        experimental_telemetry: { isEnabled: false },
      });
      return {
        value: result.text,
        usage: {
          tokensIn: result.totalUsage.inputTokens ?? -1,
          tokensOut: result.totalUsage.outputTokens ?? -1,
        },
      };
    } catch (error) {
      return failure(error, options.signal);
    }
  }
  async embed(text: string, signal: AbortSignal) {
    if (!this.embedding) throw new LlmError('LLM_NOT_CONFIGURED');
    try {
      const result = await embed({
        model: this.embedding,
        value: text,
        maxRetries: 0,
        abortSignal: signal,
        providerOptions: this.options,
        experimental_telemetry: { isEnabled: false },
      });
      return {
        value: result.embedding,
        usage: { tokensIn: result.usage.tokens ?? -1, tokensOut: 0 },
      };
    } catch (error) {
      return failure(error, signal);
    }
  }
}
export function sdkProviderFactory(
  config: LlmEnvironment,
  transport?: typeof fetch,
): ProviderFactory {
  return (selected: ProviderConfiguration, operation) => {
    const key = selected.apiKey;
    if (selected.provider === 'ollama') {
      const u = new URL(selected.baseUrl ?? config.OLLAMA_BASE_URL);
      if (
        !config.OLLAMA_ALLOWED_ORIGINS.includes(u.origin) ||
        u.href !== u.origin + '/'
      )
        throw new LlmError('LLM_ENDPOINT_FORBIDDEN');
      const provider = createOpenAICompatible({
        name: 'ollama',
        supportsStructuredOutputs: true,
        baseURL: u.origin + '/v1',
        fetch: guardedFetch([u.origin], transport),
      });
      return new SdkProvider(
        operation === 'text' ? provider.chatModel(selected.model) : undefined,
        operation === 'embedding'
          ? provider.embeddingModel(selected.model)
          : undefined,
        {
          ollama: {
            dimensions: config.EMBEDDING_DIMENSIONS,
            strictJsonSchema: false,
          },
        },
      );
    }
    if (!key) throw new LlmError('LLM_NOT_CONFIGURED');
    if (selected.provider === 'anthropic' && operation === 'text') {
      const provider = createAnthropic({
        apiKey: key,
        fetch: guardedFetch(['https://api.anthropic.com'], transport),
      });
      return new SdkProvider(provider(selected.model), undefined, {});
    }
    if (selected.provider === 'openai') {
      const provider = createOpenAI({
        apiKey: key,
        fetch: guardedFetch(['https://api.openai.com'], transport),
      });
      return new SdkProvider(
        operation === 'text' ? provider.chat(selected.model) : undefined,
        operation === 'embedding'
          ? provider.embeddingModel(selected.model)
          : undefined,
        {
          openai: {
            dimensions: config.EMBEDDING_DIMENSIONS,
            strictJsonSchema: false,
          },
        },
      );
    }
    if (selected.provider === 'mistral') {
      const provider = createMistral({
        apiKey: key,
        fetch: guardedFetch(['https://api.mistral.ai'], transport),
      });
      return new SdkProvider(
        operation === 'text' ? provider(selected.model) : undefined,
        operation === 'embedding'
          ? provider.embeddingModel(selected.model)
          : undefined,
        {},
      );
    }
    if (selected.provider === 'voyage' && operation === 'embedding') {
      const provider = createVoyage({
        apiKey: key,
        fetch: guardedFetch(['https://api.voyageai.com'], transport),
      });
      return new SdkProvider(
        undefined,
        provider.embeddingModel(selected.model),
        { voyage: { outputDimension: config.EMBEDDING_DIMENSIONS } },
      );
    }
    throw new LlmError('LLM_NOT_CONFIGURED');
  };
}
