import { Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';

@Injectable()
export class GatewayThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(GatewayThrottlerGuard.name);

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    try {
      return await super.handleRequest(requestProps);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown throttler failure';
      this.logger.warn(`Throttler storage failure detected, allowing request. cause=${message}`);
      return true;
    }
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const xForwardedFor = req.headers && (req.headers as Record<string, unknown>)['x-forwarded-for'];
    if (typeof xForwardedFor === 'string' && xForwardedFor.trim().length > 0) {
      const firstIp = xForwardedFor.split(',')[0]?.trim();
      if (firstIp) {
        return firstIp;
      }
    }

    const cfConnectingIp = req.headers && (req.headers as Record<string, unknown>)['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim().length > 0) {
      return cfConnectingIp;
    }

    if (typeof req.ips === 'object' && Array.isArray(req.ips) && req.ips.length > 0) {
      return String(req.ips[0]);
    }

    if (typeof req.ip === 'string') {
      return req.ip;
    }

    return 'unknown-client';
  }
}
