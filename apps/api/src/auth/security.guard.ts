import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Principal } from './auth.service.ts';
import { AuthService } from './auth.service.ts';
export interface AuthenticatedRequest extends Request {
  principal: Principal;
}
export class SecurityGuard implements CanActivate {
  private readonly auth: AuthService;
  private readonly reflector: Reflector;
  constructor(auth: AuthService, reflector: Reflector) {
    this.auth = auth;
    this.reflector = reflector;
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      this.auth.checkCsrf(req);
    if (
      !this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      req.principal = await this.auth.authenticate(req, res);
    return true;
  }
}
