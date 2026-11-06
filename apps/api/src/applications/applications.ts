import { Controller, Get, Post, Inject } from '@nestjs/common';
import { z } from 'zod';
import {
  applicationCreateSchema,
  applicationUpdateSchema,
  applicationMoveSchema,
} from '@jobpilot/shared/applications';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
import { ApplicationsRepository } from './applications.repository.ts';
export class ApplicationsService {
  constructor(private readonly repository: ApplicationsRepository) {}
  list(userId: string, cursor: unknown) {
    return this.repository.list(userId, z.uuid().optional().parse(cursor));
  }
  get(userId: string, id: string) {
    return this.repository.get(userId, id);
  }
  documents(userId: string, id: string, cursor: unknown) {
    return this.repository.documents(
      userId,
      id,
      z.uuid().optional().parse(cursor),
    );
  }
  create(userId: string, matchId: string, input: unknown) {
    const value = applicationCreateSchema.parse(input);
    return this.repository.create(
      userId,
      matchId,
      value.status,
      value.appliedAt,
    );
  }
  update(userId: string, id: string, input: unknown) {
    const value = applicationUpdateSchema.parse(input);
    return this.repository.update(userId, id, value.revision, value.fields);
  }
  move(userId: string, id: string, input: unknown) {
    const value = applicationMoveSchema.parse(input);
    return this.repository.move(
      userId,
      id,
      value.revision,
      value.status,
      value.appliedAt,
    );
  }
}
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}
  list(req: AuthenticatedRequest) {
    return this.service.list(req.principal.userId, req.query.cursor);
  }
  get(req: AuthenticatedRequest) {
    return this.service.get(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
  documents(req: AuthenticatedRequest) {
    return this.service.documents(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.query.cursor,
    );
  }
  create(req: AuthenticatedRequest) {
    return this.service.create(
      req.principal.userId,
      z.uuid().parse(req.params.matchId),
      req.body as unknown,
    );
  }
  update(req: AuthenticatedRequest) {
    return this.service.update(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.body as unknown,
    );
  }
  move(req: AuthenticatedRequest) {
    return this.service.move(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.body as unknown,
    );
  }
}
Inject(ApplicationsService)(ApplicationsController, undefined, 0);
Controller()(ApplicationsController);
route(ApplicationsController.prototype, 'list', Get('applications'));
route(ApplicationsController.prototype, 'get', Get('applications/:id'));
route(
  ApplicationsController.prototype,
  'documents',
  Get('applications/:id/documents'),
);
route(
  ApplicationsController.prototype,
  'create',
  Post('jobs/:matchId/application'),
);
route(ApplicationsController.prototype, 'update', Post('applications/:id'));
route(
  ApplicationsController.prototype,
  'move',
  Post('applications/:id/status'),
);
