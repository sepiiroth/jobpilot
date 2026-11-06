import { Controller, Get, Post, Inject } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
import { GenerationService } from './generation.service.ts';
import { renderResumePdf } from '../resumes/resume-pdf.ts';
import { renderLetterPdf } from './letter-pdf.ts';
export class GenerationController {
  constructor(private readonly service: GenerationService) {}
  list(req: AuthenticatedRequest) {
    return this.service.list(
      req.principal.userId,
      z.uuid().parse(req.params.matchId),
      z.uuid().optional().parse(req.query.cursor),
    );
  }
  generate(req: AuthenticatedRequest) {
    return this.service.generate(
      req.principal.userId,
      z.uuid().parse(req.params.matchId),
      req.body as unknown,
    );
  }
  get(req: AuthenticatedRequest) {
    return this.service.get(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
  edit(req: AuthenticatedRequest) {
    return this.service.edit(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.body as unknown,
    );
  }
  review(req: AuthenticatedRequest) {
    return this.service.review(
      req.principal.userId,
      z.uuid().parse(req.params.id),
      req.body as unknown,
    );
  }
  async pdf(req: AuthenticatedRequest, res: Response) {
    const value = await this.service.export(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
    const buffer =
      value.content.kind === 'resume'
        ? await renderResumePdf(value.content.data, value.params.language)
        : await renderLetterPdf(value.content.text, value.params.language);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${value.kind}-v${value.version}.pdf"`,
    );
    res.send(buffer);
  }
  async text(req: AuthenticatedRequest) {
    const value = await this.service.export(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
    return {
      text: value.content.kind === 'cover_letter' ? value.content.text : '',
    };
  }
}
Inject(GenerationService)(GenerationController, undefined, 0);
Controller()(GenerationController);
route(GenerationController.prototype, 'list', Get('jobs/:matchId/documents'));
route(
  GenerationController.prototype,
  'generate',
  Post('jobs/:matchId/documents'),
);
route(GenerationController.prototype, 'get', Get('documents/:id'));
route(GenerationController.prototype, 'edit', Post('documents/:id/versions'));
route(GenerationController.prototype, 'review', Post('documents/:id/review'));
route(GenerationController.prototype, 'pdf', Get('documents/:id/pdf'));
route(GenerationController.prototype, 'text', Get('documents/:id/text'));
