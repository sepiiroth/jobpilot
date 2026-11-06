import {
  CollectionConflict,
  CollectionRepository,
  type PrismaClient,
} from '@jobpilot/db';
import { queueConnection } from '@jobpilot/shared/collection';
import {
  collectionCronSchema,
  type OperationsEnvironment,
} from '@jobpilot/shared/operations';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

const scheduledSchema = z.strictObject({
  userId: z.uuid(),
  cron: collectionCronSchema,
});
export class OperationsRuntime {
  private readonly queue: Queue;
  private readonly redis: Redis;
  private worker?: Worker;
  constructor(
    private readonly db: PrismaClient,
    private readonly config: OperationsEnvironment & {
      VALKEY_URL: string;
      COLLECTION_QUEUE_PREFIX: string;
      COLLECTION_COOLDOWN_MINUTES: number;
    },
    private readonly backup: () => Promise<void>,
  ) {
    this.queue = new Queue('operations', {
      connection: queueConnection(config.VALKEY_URL),
      prefix: config.COLLECTION_QUEUE_PREFIX,
    });
    this.redis = new Redis(config.VALKEY_URL, { maxRetriesPerRequest: 1 });
    this.redis.on('error', () => {});
  }
  async start() {
    this.worker = new Worker(
      'operations',
      async (job) => {
        if (job.name === 'reconcile') return this.reconcile();
        if (job.name === 'purge') return this.purge();
        if (job.name === 'backup') return this.runBackup();
        if (job.name === 'scheduled-collection') {
          const { userId, cron } = scheduledSchema.parse(job.data);
          return this.collect(userId, cron);
        }
        throw new Error('Unknown operation');
      },
      {
        connection: queueConnection(this.config.VALKEY_URL, true),
        prefix: this.config.COLLECTION_QUEUE_PREFIX,
        concurrency: 1,
      },
    );
    this.worker.on('error', () => {});
    this.worker.on('failed', () =>
      console.error('Background operation failed'),
    );
    await this.worker.waitUntilReady();
    await this.queue.upsertJobScheduler(
      'operations-reconcile',
      { every: 60000 },
      {
        name: 'reconcile',
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
    await this.queue.upsertJobScheduler(
      'operations-purge',
      { pattern: '0 2 * * *', tz: 'UTC' },
      { name: 'purge', opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
    await this.queue.upsertJobScheduler(
      'operations-backup',
      { pattern: '0 3 * * *', tz: 'UTC' },
      { name: 'backup', opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
    await this.reconcile();
  }
  async reconcile() {
    // Serialize reconcilers across worker replicas; settings are read after the lock.
    await this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('operations-reconcile',0))`;
        const rows = await tx.userSettings.findMany({
          where: { collectionCron: { not: null } },
          select: { userId: true, collectionCron: true },
        });
        const active = new Set<string>();
        for (const row of rows) {
          const parsed = collectionCronSchema.safeParse(row.collectionCron);
          if (!parsed.success) continue;
          const id = 'user-' + row.userId;
          active.add(id);
          await this.queue.upsertJobScheduler(
            id,
            { pattern: parsed.data, tz: 'UTC' },
            {
              name: 'scheduled-collection',
              data: { userId: row.userId, cron: parsed.data },
              opts: { removeOnComplete: true, removeOnFail: 100 },
            },
          );
        }
        // Fetch in pages: a user may disable a schedule or delete their account.
        let offset = 0;
        const obsolete: string[] = [];
        for (;;) {
          const page = await this.queue.getJobSchedulers(
            offset,
            offset + 99,
            true,
          );
          for (const row of page)
            if (row.key.startsWith('user-') && !active.has(row.key))
              obsolete.push(row.key);
          if (page.length < 100) break;
          offset += 100;
        }
        for (const id of obsolete) await this.queue.removeJobScheduler(id);
      },
      { timeout: 60000 },
    );
    await this.publishStatus();
  }
  async collect(userId: string, cron: string) {
    try {
      // The repository rechecks the current schedule inside the collection lock.
      // Its queued run is picked up by CollectionRuntime's durable recovery loop.
      await new CollectionRepository(this.db).start(
        userId,
        this.config.COLLECTION_COOLDOWN_MINUTES,
        'scheduled',
        cron,
      );
    } catch (error) {
      if (
        !(error instanceof CollectionConflict) &&
        !(
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2003'
        )
      )
        throw error;
    }
  }
  async purge(now = new Date()) {
    let count = 0;
    // Bound lock duration and drain up to 50,000 untouched offers per daily job.
    for (let batch = 0; batch < 100; batch++) {
      const result = await this.purgeBatch(now);
      count += result.count;
      if (result.count < 500) break;
    }
    return { count };
  }
  private async purgeBatch(now: Date) {
    const cutoff = new Date(
      now.getTime() - this.config.JOB_RETENTION_DAYS * 86400000,
    );
    return this.db.$transaction(
      async (tx) => {
        // Parent locks block new references; child locks serialize existing flag edits.
        // Recheck all predicates after obtaining both sets of locks.
        const rows = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT j.id FROM job_offers j WHERE j."fetchedAt"<${cutoff}
 AND NOT EXISTS (SELECT 1 FROM user_job_matches m WHERE m."jobOfferId"=j.id AND m.status<>'new')
 AND NOT EXISTS (SELECT 1 FROM applications a WHERE a."jobOfferId"=j.id)
 AND NOT EXISTS (SELECT 1 FROM generated_documents d WHERE d."jobOfferId"=j.id)
 AND NOT EXISTS (SELECT 1 FROM collection_items i JOIN collection_runs r ON r.id=i."runId" WHERE i."jobOfferId"=j.id AND r.status IN ('queued','running'))
 ORDER BY j.id LIMIT 500 FOR UPDATE OF j SKIP LOCKED`;
        const ids = rows.map((row) => row.id);
        if (!ids.length) return { count: 0 };
        await tx.$queryRaw`SELECT id FROM user_job_matches WHERE "jobOfferId"=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        return tx.jobOffer.deleteMany({
          where: {
            id: { in: ids },
            fetchedAt: { lt: cutoff },
            matches: { none: { status: { not: 'new' } } },
            applications: { none: {} },
            documents: { none: {} },
            collected: {
              none: { run: { status: { in: ['queued', 'running'] } } },
            },
          },
        });
      },
      { timeout: 30000 },
    );
  }

  async runBackup() {
    if (!this.config.BACKUP_S3_BUCKET) return this.publishStatus();
    try {
      await this.db.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            Array<{ locked: boolean }>
          >`SELECT pg_try_advisory_xact_lock(hashtextextended('operations-backup',0)) AS locked`;
          if (!rows[0]?.locked) return;
          await this.backup();
          await this.redis.hset(
            this.config.COLLECTION_QUEUE_PREFIX + ':backup-state',
            { status: 'succeeded', lastBackupAt: new Date().toISOString() },
          );
        },
        { timeout: 660000 },
      );
    } catch {
      await this.redis.hset(
        this.config.COLLECTION_QUEUE_PREFIX + ':backup-state',
        'status',
        'failed',
      );
      throw new Error('Encrypted backup failed');
    } finally {
      await this.publishStatus();
    }
  }
  async publishStatus() {
    const state = await this.redis.hgetall(
      this.config.COLLECTION_QUEUE_PREFIX + ':backup-state',
    );
    const enabled = !!this.config.BACKUP_S3_BUCKET;
    await this.redis.set(
      this.config.COLLECTION_QUEUE_PREFIX + ':operations-status',
      JSON.stringify({
        backupsEnabled: enabled,
        lastBackupAt: state.lastBackupAt ?? null,
        backupStatus: enabled ? (state.status ?? 'pending') : 'disabled',
        updatedAt: new Date().toISOString(),
      }),
      'EX',
      180,
    );
  }
  async beforeApplicationShutdown() {
    await this.worker?.close();
    await this.queue.close();
    this.redis.disconnect();
  }
}
