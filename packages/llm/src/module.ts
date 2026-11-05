import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import type { PrismaClient } from '@jobpilot/db';
import { CryptoService } from '@jobpilot/shared/crypto';
import { llmEnvironmentSchema } from './config.ts';
import { LlmService } from './service.ts';
import { LlmRepository } from './repository.ts';
import { sdkProviderFactory } from './sdk-provider.ts';
import type { ProviderFactory } from './provider.ts';
export class LlmModule {
  static forRoot(
    db: PrismaClient,
    crypto: CryptoService,
    input: unknown,
    factory?: ProviderFactory,
  ): DynamicModule {
    const config = llmEnvironmentSchema.parse(input);
    return {
      module: LlmModule,
      providers: [
        {
          provide: LlmService,
          useValue: new LlmService(
            new LlmRepository(db),
            crypto,
            config,
            factory ?? sdkProviderFactory(config),
          ),
        },
      ],
      exports: [LlmService],
    };
  }
}
Module({})(LlmModule);
