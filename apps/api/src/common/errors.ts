import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { Response } from 'express';
export class ApiError extends HttpException {
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message, status);
    this.code = code;
  }
}
export class GlobalErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const parserStatus =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      (error.status === 400 || error.status === 413)
        ? error.status
        : undefined;
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : (parserStatus ?? 500);
    const code =
      error instanceof ApiError
        ? error.code
        : status === 400
          ? 'INVALID_REQUEST'
          : status === 429
            ? 'RATE_LIMITED'
            : status === 404
              ? 'NOT_FOUND'
              : status >= 500
                ? 'INTERNAL_ERROR'
                : 'REQUEST_REJECTED';
    const message =
      error instanceof ApiError
        ? error.message
        : status === 400
          ? 'Invalid request'
          : status === 404
            ? 'Not found'
            : status >= 500
              ? 'An internal error occurred'
              : 'Request rejected';
    response.status(status).json({ error: { code, message } });
  }
}
Catch()(GlobalErrorFilter);
