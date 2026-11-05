import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer } from 'node:http';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { createDatabaseClient } from '@jobpilot/db';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z
    .url()
    .refine((v) => ['postgres:', 'postgresql:'].includes(new URL(v).protocol)),
  VALKEY_URL: z
    .url()
    .refine((v) => ['redis:', 'rediss:'].includes(new URL(v).protocol)),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) =>
        Buffer.from(v, 'base64').length === 32 &&
        Buffer.from(v, 'base64').toString('base64') === v,
    ),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
});
try {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      'Invalid worker configuration: ' +
        parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  const config = parsed.data;
  const db = createDatabaseClient(config.DATABASE_URL);
  const redis = new Redis(config.VALKEY_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 3000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
  });
  redis.on('error', () => {});
  let ready = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.url !== '/health' || req.method !== 'GET') {
      res.writeHead(404).end(JSON.stringify({ status: 'not_found' }));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([db.$queryRaw`SELECT 1`, redis.ping()]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Health timeout')), 4000);
        }),
      ]);
      res
        .writeHead(ready ? 200 : 503)
        .end(JSON.stringify({ status: ready ? 'ok' : 'starting' }));
    } catch {
      res.writeHead(503).end(JSON.stringify({ status: 'unavailable' }));
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
  class WorkerModule {}
  Module({
    providers: [
      {
        provide: 'WORKER_RESOURCES',
        useValue: {
          async onApplicationShutdown() {
            ready = false;
            await new Promise<void>((resolve) => server.close(() => resolve()));
            redis.disconnect();
            await db.$disconnect();
          },
        },
      },
    ],
  })(WorkerModule);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
    abortOnError: false,
  });
  app.enableShutdownHooks();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.WORKER_HEALTH_PORT, '127.0.0.1', () => resolve());
  });
  ready = true;
  console.log('Worker started; no jobs configured');
} catch (error) {
  console.error(
    error instanceof Error &&
      error.message.startsWith('Invalid worker configuration:')
      ? error.message
      : 'Worker startup failed',
  );
  process.exit(1);
}
