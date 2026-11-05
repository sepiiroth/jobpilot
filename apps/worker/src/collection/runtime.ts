import { EmailAlerts } from '../email/email-alerts.ts';
import {
  emailEnvironmentSchema,
  type EmailEnvironment,
} from '@jobpilot/shared/email';
import { EmailAlertSource } from '@jobpilot/sources';
import { ScoringPipeline } from '../matching/scoring.ts';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import {
  CollectionRepository,
  embeddingProfile,
  type PrismaClient,
} from '@jobpilot/db';
import { searchInputSchema } from '@jobpilot/shared/profile';
import {
  collectionJobSchema,
  embeddingJobSchema,
  queueConnection,
  type CollectionEnvironment,
} from '@jobpilot/shared/collection';
import { CryptoService } from '@jobpilot/shared/crypto';
import { LlmService } from '@jobpilot/llm';
import {
  jobSources,
  SourceHttp,
  SourceError,
  type JobSource,
  type JsonTransport,
  type Resolver,
} from '@jobpilot/sources';
export interface RuntimeQueues {
  collection: Queue;
  embedding: Queue;
  scoring: Queue;
  permits: Map<string, Queue>;
}
export class CollectionRuntime {
  private quota: Redis | undefined;
  private readonly workers: Worker[] = [];
  private readonly events = new Map<string, QueueEvents>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closing = false;
  private recovering = false;
  constructor(
    private readonly db: PrismaClient,
    private readonly llm: LlmService,
    private readonly crypto: CryptoService,
    private readonly config: CollectionEnvironment & {
      VALKEY_URL: string;
      SCORING_LLM_TOP_N?: number;
    } & Partial<EmailEnvironment>,
    private readonly queues: RuntimeQueues,
    private readonly sources: JobSource[] = [
      ...jobSources,
      new EmailAlertSource(),
    ],
    private readonly transport?: JsonTransport,
    private readonly emailResolver?: Resolver,
  ) {}
  async start() {
    this.quota = new Redis(this.config.VALKEY_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.quota.on('error', () => {});
    await this.quota.connect();
    const options = {
      connection: queueConnection(this.config.VALKEY_URL, true),
      prefix: this.config.COLLECTION_QUEUE_PREFIX,
    };
    for (const source of this.sources) {
      const name = 'source-' + source.id;
      const worker = new Worker(name, async () => true, {
        ...options,
        concurrency: 1,
        limiter: {
          max: 1,
          duration: Math.ceil(1000 / source.requestsPerSecond),
        },
      });
      worker.on('error', () => {});
      this.workers.push(worker);
      const event = new QueueEvents(name, options);
      event.on('error', () => {});
      this.events.set(source.id, event);
    }
    const collection = new Worker(
      'collection',
      (job) => this.collect(collectionJobSchema.parse(job.data)),
      { ...options, concurrency: 2 },
    );
    collection.on('error', () => {});
    collection.on('failed', (job) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
        void this.fail(job).catch(() => {});
    });
    const embedding = new Worker(
      'embedding',
      (job) => this.embed(embeddingJobSchema.parse(job.data)),
      { ...options, concurrency: 2 },
    );
    embedding.on('error', () => {});
    embedding.on('failed', (job) => {
      if (job)
        void this.db.offerEmbedding
          .updateMany({
            where: { id: String(job.data.id), userId: String(job.data.userId) },
            data: { status: 'failed' },
          })
          .catch(() => {});
    });
    const scoring = new Worker(
      'scoring',
      (job) =>
        new ScoringPipeline(
          this.db,
          this.llm,
          this.config.SCORING_LLM_TOP_N ?? 30,
        ).run(
          collectionJobSchema.parse(job.data).userId,
          collectionJobSchema.parse(job.data).runId,
          () => this.closing,
        ),
      { ...options, concurrency: 2 },
    );
    scoring.on('error', () => {});
    scoring.on('failed', (job) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
        void this.fail(job).catch(() => {});
    });
    this.workers.push(collection, embedding, scoring);
    await Promise.all([
      ...this.workers.map((w) => w.waitUntilReady()),
      ...Array.from(this.events.values(), (e) => e.waitUntilReady()),
    ]);
    await this.recover();
    this.timer = setInterval(() => {
      void this.recover().catch(() => {});
    }, 10000);
  }
  private async fail(job: Job) {
    const data = collectionJobSchema.parse(job.data);
    await this.db.collectionRun.updateMany({
      where: {
        id: data.runId,
        userId: data.userId,
        status: { in: ['queued', 'running'] },
      },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errors: [{ source: 'worker', code: 'COLLECTION_WORKER_FAILED' }],
      },
    });
  }
  async recover() {
    if (this.recovering || this.closing) return;
    this.recovering = true;
    try {
      await this.db.collectionRun.updateMany({
        where: {
          status: 'running',
          heartbeatAt: { lt: new Date(Date.now() - 120000) },
        },
        data: { status: 'queued', workerToken: null },
      });
      const runs = await this.db.collectionRun.findMany({
        where: { status: 'queued' },
        take: 100,
        orderBy: { createdAt: 'asc' },
      });
      for (const run of runs)
        await (
          run.stage === 'scoring' ? this.queues.scoring : this.queues.collection
        ).add(
          'collect',
          { runId: run.id, userId: run.userId },
          {
            jobId: run.id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      const pending = await this.db.offerEmbedding.findMany({
        where: { status: 'pending' },
        take: 100,
      });
      for (const row of pending)
        await this.enqueueEmbedding(row.id, row.userId);
    } finally {
      this.recovering = false;
    }
  }
  private async permit(source: string) {
    const queue = this.queues.permits.get(source),
      events = this.events.get(source);
    if (!queue || !events) throw new SourceError('SOURCE_UNAVAILABLE');
    const job = await queue.add(
      'permit',
      {},
      {
        jobId: randomUUID(),
        removeOnComplete: { age: 60, count: 100 },
        removeOnFail: true,
      },
    );
    await job.waitUntilFinished(events, 60000);
  }
  async collect({ runId, userId }: { runId: string; userId: string }) {
    const repository = new CollectionRepository(this.db);
    const token = await repository.claim(userId, runId);
    if (!token) return;
    const deadline = Date.now() + 10 * 60000;
    const heartbeat = setInterval(() => {
      void repository.heartbeat(userId, runId, token).catch(() => {});
    }, 15000);
    try {
      const emailConfig = {
        ...emailEnvironmentSchema.parse({}),
        ...this.config,
      };
      const emailAlerts = new EmailAlerts(
        this.db,
        this.llm,
        this.crypto,
        emailConfig,
        undefined,
        this.emailResolver,
      );
      let emailResult: ReturnType<EmailAlerts['collect']> | undefined;
      const email = {
        configured: await emailAlerts.configured(userId),
        read: () =>
          (emailResult ??= emailAlerts.collect(
            userId,
            () => this.permit('email'),
            deadline,
          )),
      };
      const companies = await this.db.trackedCompany.findMany({
        where: { userId },
        select: { name: true, atsType: true, atsToken: true },
      });
      const credentials: Record<string, string> = {};
      for (const kind of ['adzuna_app_id', 'adzuna_app_key']) {
        const value = await this.db.userSecret.findUnique({
          where: { userId_kind: { userId, kind } },
        });
        if (value)
          credentials[kind] = this.crypto.decrypt(
            {
              ...value,
              ciphertext: Buffer.from(value.ciphertext),
              iv: Buffer.from(value.iv),
              authTag: Buffer.from(value.authTag),
            },
            `${userId}:${kind}`,
          );
      }
      const http = new SourceHttp(
        `JobPilot/0.0.0 (+${this.config.JOBPILOT_REPOSITORY_URL})`,
        async (source) => {
          if (source === 'adzuna') {
            const key =
              this.config.COLLECTION_QUEUE_PREFIX +
              ':adzuna-quota:' +
              createHash('sha256')
                .update(credentials.adzuna_app_id ?? userId)
                .digest('hex') +
              ':' +
              new Date().toISOString().slice(0, 10);
            const count = await this.quota!.eval(
              "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],172800) end;return n",
              1,
              key,
            );
            if (Number(count) > this.config.ADZUNA_DAILY_REQUEST_LIMIT)
              throw new SourceError('SOURCE_DAILY_LIMIT');
          }
          await this.permit(source);
        },
        this.config.COLLECTION_MAX_REQUESTS,
        this.transport,
      );
      const steps = await this.db.collectionStep.findMany({
        where: { runId, userId, status: { notIn: ['completed', 'failed'] } },
        orderBy: { id: 'asc' },
      });
      for (const step of steps) {
        if (this.closing) throw new SourceError('WORKER_SHUTDOWN');
        const errors: Array<{ source: string; code: string }> = [];
        let failed = false;
        const source = this.sources.find((s) => s.id === step.source);
        await this.db.collectionStep.updateMany({
          where: { id: step.id, userId },
          data: { status: 'running' },
        });
        const addError = (code: string) => {
          if (!errors.some((e) => e.code === code))
            errors.push({ source: step.source, code });
        };
        try {
          if (
            !(await this.db.search.findFirst({
              where: { id: step.searchId, userId },
            }))
          )
            throw new SourceError('SEARCH_REMOVED');
          if (!source) throw new SourceError('SOURCE_NOT_AVAILABLE');
          const ctx = {
            email,
            companies,
            credentials,
            maxPages: this.config.COLLECTION_MAX_PAGES,
            get: (url: URL, id: string) => {
              if (Date.now() > deadline)
                throw new SourceError('COLLECTION_TIME_LIMIT');
              return http.get(url, id);
            },
          };
          if (!source.isConfigured(ctx))
            throw new SourceError('SOURCE_NOT_CONFIGURED');
          for await (const raw of source.fetch(
            searchInputSchema.parse(step.criteria),
            ctx,
          )) {
            if (
              (await this.db.collectionItem.count({
                where: { userId, runId },
              })) >= this.config.COLLECTION_MAX_OFFERS
            )
              throw new SourceError('COLLECTION_OFFER_LIMIT');
            if (this.closing) throw new SourceError('WORKER_SHUTDOWN');
            let normalized;
            try {
              normalized = source.normalize(raw);
            } catch {
              addError('SOURCE_INVALID_OFFER');
              continue;
            }
            const offerId = await repository.store(
              userId,
              runId,
              step.id,
              token,
              normalized,
            );
            if (offerId) await this.prepareEmbedding(userId, offerId);
            await repository.refresh(userId, runId, false, token);
          }
        } catch (error) {
          if (this.closing) throw new SourceError('WORKER_SHUTDOWN');
          failed = true;
          addError(
            error instanceof SourceError ? error.code : 'SOURCE_UNAVAILABLE',
          );
        }
        await this.db.collectionStep.updateMany({
          where: { userId, id: step.id },
          data: { status: failed ? 'failed' : 'completed', errors },
        });
        await repository.refresh(userId, runId, false, token);
      }
      while (Date.now() < deadline) {
        if (this.closing) throw new SourceError('WORKER_SHUTDOWN');
        const pending = await repository.countCurrentEmbeddings(userId, runId, [
          'pending',
        ]);
        if (!pending) break;
        await repository.refresh(userId, runId, false, token);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const failedEmbeddings = await repository.countCurrentEmbeddings(
        userId,
        runId,
        ['failed', 'pending', 'obsolete'],
      );
      if (failedEmbeddings) {
        const step = await this.db.collectionStep.findFirst({
          where: { runId, userId },
        });
        if (step)
          await this.db.collectionStep.updateMany({
            where: { id: step.id, userId },
            data: {
              errors: [
                ...(Array.isArray(step.errors) ? step.errors : []),
                { source: 'embedding', code: 'EMBEDDING_FAILED' },
              ],
            },
          });
      }
      await repository.refresh(userId, runId, false, token);
      const handoff = await this.db.collectionRun.updateMany({
        where: {
          id: runId,
          userId,
          workerToken: token,
          status: 'running',
          stage: 'collection',
        },
        data: { stage: 'scoring', status: 'queued', workerToken: null },
      });
      if (handoff.count)
        await this.queues.scoring.add(
          'score',
          { runId, userId },
          {
            jobId: runId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
    } catch (error) {
      await this.db.collectionRun.updateMany({
        where: { id: runId, userId, workerToken: token, status: 'running' },
        data: { status: 'queued' },
      });
      throw error instanceof SourceError
        ? error
        : new Error('Collection processing failed');
    } finally {
      clearInterval(heartbeat);
    }
  }
  private async prepareEmbedding(userId: string, jobOfferId: string) {
    const offer = await this.db.jobOffer.findUniqueOrThrow({
      where: { id: jobOfferId },
    });
    const settings = await this.db.userSettings.findUnique({
      where: { userId },
    });
    const provider = settings?.embeddingProvider ?? 'openai',
      model = settings?.embeddingModel ?? 'text-embedding-3-small';
    const profileKey = embeddingProfile(
      provider,
      model,
      settings?.ollamaBaseUrl,
    );
    const row = await this.db.offerEmbedding.upsert({
      where: {
        userId_jobOfferId_profileKey_contentHash: {
          userId,
          jobOfferId,
          profileKey,
          contentHash: offer.contentHash,
        },
      },
      create: {
        userId,
        jobOfferId,
        profileKey,
        contentHash: offer.contentHash,
        provider,
        model,
      },
      update: {},
    });
    if (row.status !== 'ready') {
      if (row.status !== 'pending')
        await this.db.offerEmbedding.updateMany({
          where: { id: row.id, userId },
          data: { status: 'pending' },
        });
      await this.enqueueEmbedding(row.id, userId);
    }
  }
  private enqueueEmbedding(id: string, userId: string) {
    return this.queues.embedding.add(
      'embed',
      { id, userId },
      { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  }
  async embed({ id, userId }: { id: string; userId: string }) {
    const row = await this.db.offerEmbedding.findFirst({
      where: { id, userId },
      include: { offer: true },
    });
    if (!row || row.status === 'ready') return;
    try {
      const settings = await this.db.userSettings.findUnique({
        where: { userId },
      });
      if (
        !settings ||
        embeddingProfile(
          settings.embeddingProvider,
          settings.embeddingModel,
          settings.ollamaBaseUrl,
        ) !== row.profileKey ||
        row.offer.contentHash !== row.contentHash
      ) {
        await this.db.offerEmbedding.updateMany({
          where: { id, userId },
          data: { status: 'obsolete' },
        });
        return;
      }
      const result = await this.llm.embed(
        userId,
        [row.offer.title, row.offer.company, row.offer.description].join('\n'),
        'job_embedding',
      );
      const key = embeddingProfile(
        result.provider,
        result.model,
        settings.ollamaBaseUrl,
      );
      if (key !== row.profileKey) throw new Error('Changed embedding settings');
      const updated = await this.db
        .$executeRaw`UPDATE offer_embeddings SET embedding=${JSON.stringify(result.embedding)}::vector,status='ready' WHERE id=${id}::uuid AND "userId"=${userId}::uuid AND EXISTS (SELECT 1 FROM job_offers j WHERE j.id=${row.jobOfferId}::uuid AND j."contentHash"=${row.contentHash}) AND EXISTS (SELECT 1 FROM user_settings s WHERE s."userId"=${userId}::uuid AND s."embeddingProvider"=${row.provider} AND s."embeddingModel"=${row.model} AND s."ollamaBaseUrl"=${settings.ollamaBaseUrl})`;
      if (!updated)
        await this.db.offerEmbedding.updateMany({
          where: { id, userId, status: 'pending' },
          data: { status: 'obsolete' },
        });
    } catch {
      await this.db.offerEmbedding.updateMany({
        where: { id, userId },
        data: { status: 'failed' },
      });
    }
  }
  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all(Array.from(this.events.values(), (e) => e.close()));
    this.quota?.disconnect();
  }
  beforeApplicationShutdown() {
    return this.close();
  }
}
