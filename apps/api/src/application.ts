import { GenerationController } from './generation/generation.controller.ts';
import { GenerationService } from './generation/generation.service.ts';
import { GenerationRepository } from './generation/generation.repository.ts';
import { JobsController, JobsService } from './jobs/jobs.ts';
import { JobsRepository } from './jobs/jobs.repository.ts';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { queueConnection } from '@jobpilot/shared/collection';
import { CollectionRepository } from '@jobpilot/db';
import {
  CollectionsController,
  CollectionsService,
} from './collections/collections.ts';
import 'reflect-metadata';
import { LlmModule, LlmService, type ProviderFactory } from '@jobpilot/llm';
import { ResumeEmbeddings } from './resumes/resume-embeddings.ts';
import { LlmController } from './llm/llm.controller.ts';
import { Module } from '@nestjs/common';
import { NestFactory, APP_GUARD, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigModule } from '@nestjs/config';
import {
  ThrottlerModule,
  ThrottlerGuard,
  getOptionsToken,
  getStorageToken,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { DestinationStream } from 'pino';
import { LoggerModule, Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Redis } from 'ioredis';
import { createDatabaseClient, type PrismaClient } from '@jobpilot/db';
import { parseEnvironment, type Environment } from './config/environment.ts';
import { AuthService } from './auth/auth.service.ts';
import { AuthRepository } from './auth/auth.repository.ts';
import { Passwords } from './auth/passwords.ts';
import { RateLimiter } from './auth/rate-limit.ts';
import { SecurityGuard } from './auth/security.guard.ts';
import { AuthController } from './auth/auth.controller.ts';
import { UsersController } from './users/users.controller.ts';
import { UsersService } from './users/users.service.ts';
import { UsersRepository } from './users/users.repository.ts';
import { CryptoService } from './crypto/crypto.service.ts';
import { HealthController } from './health/health.controller.ts';
import { GlobalErrorFilter } from './common/errors.ts';
import { loggingOptions } from './logging.ts';
import { ResumesController } from './resumes/resumes.controller.ts';
import { ResumesService } from './resumes/resumes.service.ts';
import { ResumesRepository } from './resumes/resumes.repository.ts';
import { SearchesController } from './searches/searches.controller.ts';
import { SearchesService } from './searches/searches.service.ts';
import { SearchesRepository } from './searches/searches.repository.ts';
import { SettingsController } from './settings/settings.controller.ts';
import { SettingsService } from './settings/settings.service.ts';
import { SettingsRepository } from './settings/settings.repository.ts';
export interface ApplicationResources {
  db: PrismaClient;
  redis: Redis;
  logs?: DestinationStream;
  llmFactory?: ProviderFactory;
}
export async function createApplication(
  input: unknown = process.env,
  resources?: ApplicationResources,
): Promise<NestExpressApplication> {
  const config: Environment = parseEnvironment(input);
  const db = resources?.db ?? createDatabaseClient(config.DATABASE_URL);
  const redis =
    resources?.redis ??
    new Redis(config.VALKEY_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      commandTimeout: 3000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
    });
  redis.on('error', () => {});
  const passwords = new Passwords();
  await passwords.initialize();
  const repository = new AuthRepository(db);
  const limiter = new RateLimiter(redis, config.SESSION_SECRET);
  const auth = new AuthService(repository, passwords, limiter, config);
  class InfrastructureModule {}
  Module({
    providers: [
      { provide: 'DATABASE', useValue: db },
      { provide: 'VALKEY', useValue: redis },
      {
        provide: 'RESOURCE_LIFECYCLE',
        useValue: {
          async onApplicationShutdown() {
            if (!resources) {
              await db.$disconnect();
              redis.disconnect();
            }
          },
        },
      },
    ],
    exports: ['DATABASE', 'VALKEY'],
  })(InfrastructureModule);
  class CryptoModule {}
  Module({
    providers: [
      { provide: CryptoService, useValue: new CryptoService(config) },
    ],
    exports: [CryptoService],
  })(CryptoModule);
  class AuthModule {}
  Module({
    controllers: [AuthController],
    providers: [{ provide: AuthService, useValue: auth }],
    exports: [AuthService],
  })(AuthModule);
  class UsersModule {}
  Module({
    imports: [AuthModule],
    controllers: [UsersController],
    providers: [
      {
        provide: UsersService,
        useValue: new UsersService(
          new UsersRepository(db),
          repository,
          passwords,
        ),
      },
    ],
  })(UsersModule);
  class HealthModule {}
  Module({
    imports: [InfrastructureModule, TerminusModule],
    controllers: [HealthController],
  })(HealthModule);
  const llmModule = LlmModule.forRoot(
    db,
    new CryptoService(config),
    input,
    resources?.llmFactory,
  );
  class ResumesModule {}
  Module({
    imports: [llmModule],
    controllers: [ResumesController],
    exports: [ResumeEmbeddings],
    providers: [
      {
        provide: ResumeEmbeddings,
        useFactory: (llm: LlmService) => new ResumeEmbeddings(db, llm),
        inject: [LlmService],
      },
      {
        provide: ResumesService,
        useFactory: (embeddings: ResumeEmbeddings, llm: LlmService) =>
          new ResumesService(new ResumesRepository(db), embeddings, llm),
        inject: [ResumeEmbeddings, LlmService],
      },
    ],
  })(ResumesModule);
  class SearchesModule {}
  Module({
    controllers: [SearchesController],
    providers: [
      {
        provide: SearchesService,
        useValue: new SearchesService(new SearchesRepository(db)),
      },
    ],
  })(SearchesModule);
  class SettingsModule {}
  Module({
    imports: [ResumesModule],
    controllers: [SettingsController],
    providers: [
      {
        provide: SettingsService,
        useFactory: (embeddings: ResumeEmbeddings) =>
          new SettingsService(
            new SettingsRepository(db),
            new CryptoService(config),
            embeddings,
            config,
          ),
        inject: [ResumeEmbeddings],
      },
    ],
  })(SettingsModule);
  class LlmHttpModule {}
  Module({ imports: [llmModule], controllers: [LlmController] })(LlmHttpModule);
  class CollectionsModule {}
  Module({
    imports: [
      BullModule.forRoot({
        connection: queueConnection(config.VALKEY_URL),
        prefix: config.COLLECTION_QUEUE_PREFIX,
      }),
      BullModule.registerQueue({ name: 'collection' }),
    ],
    controllers: [CollectionsController],
    providers: [
      {
        provide: CollectionsService,
        useFactory: (queue: Queue) =>
          new CollectionsService(
            new CollectionRepository(db),
            queue,
            config.COLLECTION_COOLDOWN_MINUTES,
          ),
        inject: [getQueueToken('collection')],
      },
    ],
  })(CollectionsModule);
  class JobsModule {}
  Module({
    controllers: [JobsController],
    providers: [
      {
        provide: JobsService,
        useFactory: () => new JobsService(new JobsRepository(db)),
      },
    ],
  })(JobsModule);
  class GenerationModule {}
  Module({
    imports: [llmModule],
    controllers: [GenerationController],
    providers: [
      {
        provide: GenerationService,
        useFactory: (llm: LlmService) =>
          new GenerationService(new GenerationRepository(db), llm),
        inject: [LlmService],
      },
    ],
  })(GenerationModule);
  class AppModule {}
  Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: () => config,
      }),
      LoggerModule.forRoot({
        pinoHttp: resources?.logs
          ? [loggingOptions(config.LOG_LEVEL), resources.logs]
          : loggingOptions(config.LOG_LEVEL),
      }),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
      InfrastructureModule,
      CryptoModule,
      AuthModule,
      UsersModule,
      ResumesModule,
      SearchesModule,
      SettingsModule,
      HealthModule,
      LlmHttpModule,
      CollectionsModule,
      JobsModule,
      GenerationModule,
    ],
    providers: [
      { provide: Reflector, useValue: new Reflector() },
      {
        provide: APP_GUARD,
        useFactory: (
          options: ThrottlerModuleOptions,
          storage: ThrottlerStorage,
          reflector: Reflector,
        ) => new ThrottlerGuard(options, storage, reflector),
        inject: [getOptionsToken(), getStorageToken(), Reflector],
      },
      {
        provide: APP_GUARD,
        useFactory: (reflector: Reflector) =>
          new SecurityGuard(auth, reflector),
        inject: [Reflector],
      },
    ],
  })(AppModule);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(helmet());
  app.useBodyParser('raw', { type: 'application/pdf', limit: '5mb' });
  app.useBodyParser('json', { limit: '1mb' });
  app.use(cookieParser());
  app.enableCors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  });
  app.useGlobalFilters(new GlobalErrorFilter());
  if (config.NODE_ENV === 'development') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(config.APP_NAME + ' API')
        .setVersion('0.0.0')
        .addCookieAuth('jobpilot_session')
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
  app.enableShutdownHooks();
  await app.init();
  return app;
}
