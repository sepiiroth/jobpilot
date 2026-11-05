import { Controller, Get, Post, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginSchema, changePasswordSchema } from '@jobpilot/shared';
import { AuthService } from './auth.service.ts';
import type { AuthenticatedRequest } from './security.guard.ts';
import { route } from '../common/http.ts';
export class AuthController {
  private readonly auth: AuthService;
  constructor(auth: AuthService) {
    this.auth = auth;
  }
  csrf(req: Request, res: Response) {
    return this.auth.issueCsrf(req, res);
  }
  login(req: Request, res: Response) {
    const value = loginSchema.parse(req.body as unknown);
    return this.auth.login(value.email, value.password, req, res);
  }
  me(req: AuthenticatedRequest) {
    return this.auth.me(req.principal);
  }
  async logout(req: AuthenticatedRequest, res: Response) {
    await this.auth.logout(req.principal, res, false);
    return { ok: true };
  }
  async logoutAll(req: AuthenticatedRequest, res: Response) {
    await this.auth.logout(req.principal, res, true);
    return { ok: true };
  }
  async password(req: AuthenticatedRequest, res: Response) {
    const value = changePasswordSchema.parse(req.body as unknown);
    await this.auth.changePassword(
      req.principal,
      value.currentPassword,
      value.newPassword,
      res,
    );
    return { ok: true };
  }
}
Inject(AuthService)(AuthController, undefined, 0);
Controller('auth')(AuthController);
route(AuthController.prototype, 'csrf', Get('csrf'), true);
route(AuthController.prototype, 'login', Post('login'), true);
route(AuthController.prototype, 'me', Get('me'));
route(AuthController.prototype, 'logout', Post('logout'));
route(AuthController.prototype, 'logoutAll', Post('logout-all'));
route(AuthController.prototype, 'password', Post('password'));
