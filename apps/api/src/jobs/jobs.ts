import { Controller, Get, Post, Inject } from '@nestjs/common';
import { z } from 'zod';
import { jobQuerySchema, jobStatusInputSchema } from '@jobpilot/shared/jobs';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
import { ApiError } from '../common/errors.ts';
import { JobsRepository } from './jobs.repository.ts';
export class JobsService {
  constructor(private readonly repository: JobsRepository) {}
  list(userId: string, query: unknown) {
    return this.repository.list(userId, jobQuerySchema.parse(query));
  }
  summary(userId: string) {
    return this.repository.summary(userId);
  }
  async get(userId: string, id: string) {
    const row = await this.repository.get(userId, id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    return row;
  }
  async status(userId: string, id: string, input: unknown) {
    const row = await this.repository.status(
      userId,
      id,
      jobStatusInputSchema.parse(input).status,
      jobStatusInputSchema.parse(input).appliedAt,
    );
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    return row;
  }
}
export class JobsController {
  constructor(private readonly service: JobsService) {}
  list(req: AuthenticatedRequest) {
    return this.service.list(req.principal.userId, req.query);
  }
  summary(req: AuthenticatedRequest) {
    return this.service.summary(req.principal.userId);
  }
  get(req: AuthenticatedRequest) {
    return this.service.get(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
  status(req: AuthenticatedRequest) {
    return this.service.status(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.body as unknown,
    );
  }
}
Inject(JobsService)(JobsController, undefined, 0);
Controller('jobs')(JobsController);
route(JobsController.prototype, 'summary', Get('summary'));
route(JobsController.prototype, 'list', Get());
route(JobsController.prototype, 'get', Get(':id'));
route(JobsController.prototype, 'status', Post(':id/status'));
