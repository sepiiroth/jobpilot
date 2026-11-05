import { Controller, Get, Post, Delete, Inject } from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
import { SearchesService } from './searches.service.ts';
export class SearchesController {
  constructor(private readonly service: SearchesService) {}
  list(req: AuthenticatedRequest) {
    return this.service.list(req.principal.userId);
  }
  get(req: AuthenticatedRequest) {
    return this.service.get(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
  create(req: AuthenticatedRequest) {
    return this.service.save(
      req.principal.userId,
      undefined,
      req.body as unknown,
    );
  }
  update(req: AuthenticatedRequest) {
    return this.service.save(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.body as unknown,
    );
  }
  delete(req: AuthenticatedRequest) {
    return this.service.delete(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
}
Inject(SearchesService)(SearchesController, undefined, 0);
Controller('searches')(SearchesController);
route(SearchesController.prototype, 'list', Get());
route(SearchesController.prototype, 'create', Post());
route(SearchesController.prototype, 'get', Get(':id'));
route(SearchesController.prototype, 'update', Post(':id'));
route(SearchesController.prototype, 'delete', Delete(':id'));
