export type LlmErrorCode =
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_BUDGET_EXCEEDED'
  | 'LLM_TIMEOUT'
  | 'LLM_INVALID_OUTPUT'
  | 'LLM_UNAVAILABLE'
  | 'LLM_ENDPOINT_FORBIDDEN';
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    readonly retryable = false,
  ) {
    super(code);
  }
}
