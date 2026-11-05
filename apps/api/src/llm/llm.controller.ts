import { Controller, Get, Inject } from '@nestjs/common';
import { LlmService } from '@jobpilot/llm';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
export class LlmController {
  constructor(private readonly llm: LlmService) {}
  usage(req: AuthenticatedRequest) {
    return this.llm.summary(req.principal.userId);
  }
}
Inject(LlmService)(LlmController, undefined, 0);
Controller('llm')(LlmController);
route(LlmController.prototype, 'usage', Get('usage'));
