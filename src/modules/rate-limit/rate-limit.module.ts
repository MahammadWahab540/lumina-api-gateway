import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { GatewayThrottlerGuard } from './gateway-throttler.guard';

function getPath(context: { switchToHttp: () => { getRequest: () => { raw?: { url?: string }; url?: string } } }): string {
  const request = context.switchToHttp().getRequest();
  return request.raw?.url || request.url || '/';
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        storage: new ThrottlerStorageRedisService(config.redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 150,
          retryStrategy: () => null,
        }),
        setHeaders: true,
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimit.global.ttlMs,
            limit: config.rateLimit.global.limit,
            blockDuration: config.rateLimit.global.blockDurationMs,
          },
          {
            name: 'auth',
            ttl: config.rateLimit.auth.ttlMs,
            limit: config.rateLimit.auth.limit,
            blockDuration: config.rateLimit.auth.blockDurationMs,
            skipIf: (context) => !getPath(context).startsWith('/auth'),
          },
          {
            name: 'ai',
            ttl: config.rateLimit.ai.ttlMs,
            limit: config.rateLimit.ai.limit,
            blockDuration: config.rateLimit.ai.blockDurationMs,
            skipIf: (context) => !getPath(context).startsWith('/ai'),
          },
        ],
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: GatewayThrottlerGuard,
    },
  ],
})
export class RateLimitModule {}
