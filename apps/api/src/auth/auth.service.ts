import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response, CookieOptions } from 'express';
import type { Environment } from '../config/environment.ts';
import { ApiError } from '../common/errors.ts';
import { AuthRepository } from './auth.repository.ts';
import { Passwords } from './passwords.ts';
import { RateLimiter } from './rate-limit.ts';
export interface Principal {
  userId: string;
  sessionId: string;
  token: string;
  expiresAt: Date;
}
export const SESSION_COOKIE = 'jobpilot_session';
export const CSRF_COOKIE = 'jobpilot_csrf';
const unauthorized = () =>
  new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function cookies(req: Request): Record<string, unknown> {
  return (req.cookies ?? {}) as Record<string, unknown>;
}
export class AuthService {
  private readonly repository: AuthRepository;
  private readonly passwords: Passwords;
  private readonly limiter: RateLimiter;
  private readonly config: Environment;
  constructor(
    repository: AuthRepository,
    passwords: Passwords,
    limiter: RateLimiter,
    config: Environment,
  ) {
    this.repository = repository;
    this.passwords = passwords;
    this.limiter = limiter;
    this.config = config;
  }
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      ...(this.config.COOKIE_DOMAIN
        ? { domain: this.config.COOKIE_DOMAIN }
        : {}),
    };
  }
  private csrfSignature(nonce: string, token: string): string {
    return createHmac('sha256', this.config.SESSION_SECRET)
      .update(nonce + ':' + token)
      .digest('base64url');
  }
  issueCsrf(
    req: Request,
    res: Response,
    token?: string,
  ): { csrfToken: string } {
    const raw = cookies(req)[SESSION_COOKIE];
    const binding = token ?? (typeof raw === 'string' ? raw : 'guest');
    const nonce = randomBytes(32).toString('base64url');
    const csrfToken = nonce + '.' + this.csrfSignature(nonce, binding);
    res.cookie(CSRF_COOKIE, csrfToken, {
      ...this.cookieOptions(),
      maxAge: 7 * 86400000,
    });
    res.setHeader('Cache-Control', 'no-store');
    return { csrfToken };
  }
  checkCsrf(req: Request): void {
    if (req.headers.origin && req.headers.origin !== this.config.WEB_ORIGIN)
      throw new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token');
    const header = req.headers['x-csrf-token'],
      cookie = cookies(req)[CSRF_COOKIE],
      raw = cookies(req)[SESSION_COOKIE];
    if (
      typeof header !== 'string' ||
      typeof cookie !== 'string' ||
      !equal(header, cookie)
    )
      throw new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token');
    const [nonce, signature] = header.split('.');
    if (
      !nonce ||
      !signature ||
      !equal(
        signature,
        this.csrfSignature(nonce, typeof raw === 'string' ? raw : 'guest'),
      )
    )
      throw new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token');
  }
  async login(email: string, password: string, req: Request, res: Response) {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    await this.limiter.consume('login-ip', ip, 100, 900000);
    await this.limiter.consume('login-pair', ip + ':' + email, 5, 900000);
    const user = await this.repository.userByEmail(email);
    const valid = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !valid)
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    const session = await this.repository.createSession(
      user.id,
      user.passwordHash,
      {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt,
        ip,
        userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
      },
    );
    if (!session) throw unauthorized();
    res.cookie(SESSION_COOKIE, token, {
      ...this.cookieOptions(),
      expires: expiresAt,
    });
    await this.repository.audit(user.id, 'auth.login', ip);
    return {
      user: { id: user.id, email: user.email, locale: user.locale },
      ...this.issueCsrf(req, res, token),
    };
  }
  async authenticate(req: Request, res: Response): Promise<Principal> {
    const raw = cookies(req)[SESSION_COOKIE];
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw))
      throw unauthorized();
    const session = await this.repository.session(
      createHash('sha256').update(raw).digest('hex'),
    );
    const now = new Date();
    if (
      !session ||
      session.expiresAt <= now ||
      session.createdAt.getTime() + 30 * 86400000 <= now.getTime()
    )
      throw unauthorized();
    const expiresAt = new Date(
      Math.min(
        now.getTime() + 7 * 86400000,
        session.createdAt.getTime() + 30 * 86400000,
      ),
    );
    const changed = await this.repository.touchSession(
      session.id,
      session.userId,
      now,
      expiresAt,
    );
    if (changed.count !== 1) throw unauthorized();
    await this.limiter.consume('session', session.id, 100, 60000);
    res.cookie(SESSION_COOKIE, raw, {
      ...this.cookieOptions(),
      expires: expiresAt,
    });
    res.setHeader('Cache-Control', 'no-store');
    return {
      userId: session.userId,
      sessionId: session.id,
      token: raw,
      expiresAt,
    };
  }
  clearCookies(res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
    res.clearCookie(CSRF_COOKIE, this.cookieOptions());
  }
  async logout(
    principal: Principal,
    res: Response,
    all: boolean,
  ): Promise<void> {
    if (all) await this.repository.removeSessions(principal.userId);
    else
      await this.repository.removeSession(
        principal.sessionId,
        principal.userId,
      );
    this.clearCookies(res);
  }
  async me(principal: Principal) {
    const user = await this.repository.userById(principal.userId);
    if (!user) throw unauthorized();
    return user;
  }
  async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    res: Response,
  ): Promise<void> {
    const user = await this.me(principal);
    const record = await this.repository.userByEmail(user.email);
    if (
      !record ||
      !(await this.passwords.verify(record.passwordHash, currentPassword))
    )
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    const changed = await this.repository.changePassword(
      principal.userId,
      record.passwordHash,
      await this.passwords.hash(newPassword),
    );
    if (!changed) throw unauthorized();
    this.clearCookies(res);
  }
}
