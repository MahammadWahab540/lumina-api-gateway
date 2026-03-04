import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  async getHealth(): Promise<Record<string, unknown>> {
    let redisStatus: 'up' | 'down' = 'up';

    try {
      await this.redis.ping();
    } catch {
      redisStatus = 'down';
    }

    return {
      status: redisStatus === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        process: 'up',
        redis: redisStatus,
      },
    };
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
