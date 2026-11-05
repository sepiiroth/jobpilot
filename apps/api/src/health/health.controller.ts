import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthCheckService } from '@nestjs/terminus';
import type { PrismaClient } from '@jobpilot/db';
import type { Redis } from 'ioredis';
import { route } from '../common/http.ts';
export class HealthController {
  private readonly db: PrismaClient;
  private readonly redis: Redis;
  private readonly health: HealthCheckService;
  constructor(db: PrismaClient, redis: Redis, health: HealthCheckService) {
    this.db = db;
    this.redis = redis;
    this.health = health;
  }
  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ServiceUnavailableException()),
            4000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  check() {
    return this.health.check([
      async () => {
        await this.bounded(this.db.$queryRaw`SELECT 1`);
        return { database: { status: 'up' } };
      },
      async () => {
        if ((await this.bounded(this.redis.ping())) !== 'PONG')
          throw new Error('Valkey unavailable');
        return { valkey: { status: 'up' } };
      },
    ]);
  }
}
Inject('DATABASE')(HealthController, undefined, 0);
Inject('VALKEY')(HealthController, undefined, 1);
Inject(HealthCheckService)(HealthController, undefined, 2);
Controller('health')(HealthController);
route(HealthController.prototype, 'check', Get(), true);
