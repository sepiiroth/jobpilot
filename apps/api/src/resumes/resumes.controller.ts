import { Controller, Get, Post, Delete, Inject } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
import { ResumesService } from './resumes.service.ts';
import { renderResumePdf } from './resume-pdf.ts';
export class ResumesController {
  constructor(private readonly service: ResumesService) {}
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
  async pdf(req: AuthenticatedRequest, res: Response) {
    const resume = await this.service.get(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
    const buffer = await renderResumePdf(resume.data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
    res.send(buffer);
  }
}
Inject(ResumesService)(ResumesController, undefined, 0);
Controller('resumes')(ResumesController);
route(ResumesController.prototype, 'list', Get());
route(ResumesController.prototype, 'create', Post());
route(ResumesController.prototype, 'get', Get(':id'));
route(ResumesController.prototype, 'update', Post(':id'));
route(ResumesController.prototype, 'delete', Delete(':id'));
route(ResumesController.prototype, 'pdf', Get(':id/pdf'));
