import type { z } from 'zod';
export interface Usage {
  tokensIn: number;
  tokensOut: number;
}
export interface LlmResult<T> {
  value: T;
  usage: Usage;
}
export interface Prompt {
  version: string;
  system: string;
  user: string;
}
export interface CallOptions {
  signal: AbortSignal;
  maxOutputTokens: number;
}
export interface LlmProvider {
  generateStructured<T>(
    prompt: Prompt,
    schema: z.ZodType<T>,
    options: CallOptions,
  ): Promise<LlmResult<T>>;
  generateText(
    prompt: Prompt,
    options: CallOptions,
  ): Promise<LlmResult<string>>;
  embed(text: string, signal: AbortSignal): Promise<LlmResult<number[]>>;
}
export interface ProviderConfiguration {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}
export type ProviderFactory = (
  config: ProviderConfiguration,
  operation: 'text' | 'embedding',
) => LlmProvider;
