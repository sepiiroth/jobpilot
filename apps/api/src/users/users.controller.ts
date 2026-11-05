import { Controller, Get, Delete, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { deleteAccountSchema } from '@jobpilot/shared';
import { UsersService } from './users.service.ts';
import { AuthService } from '../auth/auth.service.ts';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
export class UsersController {
  private readonly users: UsersService;
  private readonly auth: AuthService;
  constructor(users: UsersService, auth: AuthService) {
    this.users = users;
    this.auth = auth;
  }
  export(req: AuthenticatedRequest, res: Response) {
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="jobpilot-export.json"',
    );
    return this.users.export(req.principal.userId);
  }
  async delete(req: AuthenticatedRequest, res: Response) {
    const data = deleteAccountSchema.parse(req.body as unknown);
    await this.users.delete(req.principal.userId, data.password);
    this.auth.clearCookies(res);
    return { ok: true };
  }
}
Inject(UsersService)(UsersController, undefined, 0);
Inject(AuthService)(UsersController, undefined, 1);
Controller('users/me')(UsersController);
route(UsersController.prototype, 'export', Get('export'));
route(UsersController.prototype, 'delete', Delete());
