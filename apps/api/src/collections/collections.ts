import { Controller, Get, Post, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CollectionRepository, CollectionConflict } from '@jobpilot/db';
import type { Queue } from 'bullmq';
import type { AuthenticatedRequest } from '../auth/security.guard.ts';
import { route } from '../common/http.ts';
import { ApiError } from '../common/errors.ts';
export class CollectionsService {
  constructor(
    private readonly repository: CollectionRepository,
    private readonly queue: Queue,
    private readonly cooldown: number,
  ) {}
  latest(userId: string) {
    return this.repository.latest(userId);
  }
  async get(userId: string, id: string) {
    const result = await this.repository.get(userId, id);
    if (!result) throw new ApiError(404, 'NOT_FOUND', 'Collection not found');
    return result;
  }
  async start(userId: string) {
    try {
      const run = await this.repository.start(userId, this.cooldown);
      try {
        await this.queue.add(
          'collect',
          { runId: run.id, userId },
          {
            jobId: run.id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
        await this.repository.db.collectionRun.updateMany({
          where: { userId, id: run.id },
          data: { enqueuedAt: new Date() },
        });
      } catch {
        /* The worker recovers committed queued runs from the database. */
      }
      return this.get(userId, run.id);
    } catch (error) {
      if (error instanceof CollectionConflict)
        throw new ApiError(
          error.code === 'COLLECTION_COOLDOWN' ? 429 : 409,
          error.code,
          'Collection cannot start',
        );
      throw error;
    }
  }
}
export class CollectionsController {
  constructor(private readonly service: CollectionsService) {}
  async latest(req: AuthenticatedRequest, res: Response) {
    res.json(await this.service.latest(req.principal.userId));
  }
  start(req: AuthenticatedRequest) {
    z.strictObject({}).parse(req.body as unknown);
    return this.service.start(req.principal.userId);
  }
  get(req: AuthenticatedRequest) {
    return this.service.get(
      req.principal.userId,
      z.uuid().parse(req.params.id),
    );
  }
  async events(req: AuthenticatedRequest, res: Response) {
    const id = z.uuid().parse(req.params.id);
    await this.service.get(req.principal.userId, id);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    try {
      for (let tick = 0; tick < 20 && !closed; tick++) {
        const run = await this.service.get(req.principal.userId, id);
        res.write('data: ' + JSON.stringify(run) + '\n\n');
        if (!['queued', 'running'].includes(run.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch {
      if (!closed)
        res.write('event: error\ndata: {"code":"COLLECTION_UNAVAILABLE"}\n\n');
    } finally {
      res.end();
    }
  }
}
Inject(CollectionsService)(CollectionsController, undefined, 0);
Controller('collections')(CollectionsController);
route(CollectionsController.prototype, 'latest', Get());
route(CollectionsController.prototype, 'start', Post());
route(CollectionsController.prototype, 'get', Get(':id'));
route(CollectionsController.prototype, 'events', Get(':id/events'));
