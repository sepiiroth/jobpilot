import { Controller, Get, Post, Delete, Inject } from '@nestjs/common';
import { z } from 'zod';
import { secretKindSchema } from '@jobpilot/shared/profile';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
import { SettingsService } from './settings.service.ts';
export class SettingsController {
  constructor(private readonly service: SettingsService) {}
  get(req: AuthenticatedRequest) {
    return this.service.get(req.principal.userId);
  }
  save(req: AuthenticatedRequest) {
    return this.service.save(req.principal.userId, req.body as unknown);
  }
  secrets(req: AuthenticatedRequest) {
    return this.service.secrets(req.principal.userId);
  }
  secret(req: AuthenticatedRequest) {
    return this.service.secret(
      req.principal.userId,
      secretKindSchema.parse(req.params.kind),
    );
  }
  saveSecret(req: AuthenticatedRequest) {
    return this.service.saveSecret(
      req.principal.userId,
      secretKindSchema.parse(req.params.kind),
      req.body as unknown,
    );
  }
  deleteSecret(req: AuthenticatedRequest) {
    return this.service.deleteSecret(
      req.principal.userId,
      secretKindSchema.parse(req.params.kind),
    );
  }
  companies(req: AuthenticatedRequest) {
    return this.service.companies(req.principal.userId);
  }
  company(req: AuthenticatedRequest) {
    return this.service.company(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
  createCompany(req: AuthenticatedRequest) {
    return this.service.saveCompany(
      req.principal.userId,
      undefined,
      req.body as unknown,
    );
  }
  updateCompany(req: AuthenticatedRequest) {
    return this.service.saveCompany(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.body as unknown,
    );
  }
  deleteCompany(req: AuthenticatedRequest) {
    return this.service.deleteCompany(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
}
Inject(SettingsService)(SettingsController, undefined, 0);
Controller('settings')(SettingsController);
for (const [name, method] of Object.entries({
  get: Get(),
  save: Post(),
  secrets: Get('secrets'),
  secret: Get('secrets/:kind'),
  saveSecret: Post('secrets/:kind'),
  deleteSecret: Delete('secrets/:kind'),
  companies: Get('companies'),
  company: Get('companies/:id'),
  createCompany: Post('companies'),
  updateCompany: Post('companies/:id'),
  deleteCompany: Delete('companies/:id'),
}))
  route(SettingsController.prototype, name, method);
