import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { APP_CONFIG } from '../../config/config.constants';
import { isPublicRoute } from '../../config/configuration';
import { AppConfig } from '../../config/config.types';
import { SUPABASE_AUTH_STRATEGY } from './auth.constants';
import { PUBLIC_ROUTE_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard(SUPABASE_AUTH_STRATEGY) implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isMarkedPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isMarkedPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const path = request.raw.url || request.url;

    if (isPublicRoute(path, this.config.publicRoutes)) {
      return true;
    }

    try {
      return await Promise.resolve(super.canActivate(context) as boolean | Promise<boolean>);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unknown authentication strategy')) {
        this.logger.error(
          `Passport strategy '${SUPABASE_AUTH_STRATEGY}' is unavailable during request auth`,
          error.stack,
        );
        throw new ServiceUnavailableException({
          code: 'AUTH_STRATEGY_UNAVAILABLE',
          message: `Authentication strategy '${SUPABASE_AUTH_STRATEGY}' is not registered`,
          details: { strategy: SUPABASE_AUTH_STRATEGY },
        });
      }

      throw error;
    }
  }
}
