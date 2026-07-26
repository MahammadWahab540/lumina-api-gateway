import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { APP_CONFIG } from '../../config/config.constants';
import { isPublicRoute } from '../../config/configuration';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from './auth.types';
import { SUPABASE_AUTH_STRATEGY } from './auth.constants';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { SupabaseTokenValidatorService } from './supabase-token-validator.service';

function parseJwtUnverified(token: string): { header?: Record<string, unknown>; payload?: Record<string, unknown> } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, payload };
  } catch {
    return {};
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard(SUPABASE_AUTH_STRATEGY) implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly supabaseTokenValidator: SupabaseTokenValidatorService,
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
    const path = request.raw?.url || request.url || '/';

    if (isPublicRoute(path, this.config.publicRoutes)) {
      return true;
    }

    try {
      const activated = await Promise.resolve(super.canActivate(context) as boolean | Promise<boolean>);
      if (activated) return true;
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

      const fallbackClaims = await this.trySupabaseIntrospection(request);
      if (fallbackClaims) {
        (request as FastifyRequest & { user?: GatewayClaims }).user = fallbackClaims;
        return true;
      }

      const authorization = request.headers.authorization;
      const reqId = (request.headers['x-request-id'] as string) || (request.id as string) || 'req-unauth';
      const authHeaderPresent = typeof authorization === 'string' && authorization.trim().length > 0;

      let tokenIssuer = 'none';
      let tokenAudience = 'none';
      let tokenAlgorithm = 'none';
      let tokenExp = 'none';

      if (authHeaderPresent && authorization) {
        const match = authorization.match(/^Bearer\s+(.+)$/i);
        if (match?.[1]) {
          const { header, payload } = parseJwtUnverified(match[1].trim());
          if (header?.alg) tokenAlgorithm = String(header.alg);
          if (payload?.iss) tokenIssuer = String(payload.iss);
          if (payload?.aud) tokenAudience = String(payload.aud);
          if (payload?.exp) tokenExp = new Date(Number(payload.exp) * 1000).toISOString();
        }
      }

      this.logger.warn(
        `Auth validation failed [requestId=${reqId}, path=${path}, authHeaderPresent=${authHeaderPresent}, iss=${tokenIssuer}, aud=${tokenAudience}, alg=${tokenAlgorithm}, exp=${tokenExp}, failureCategory=${error instanceof Error ? error.message : 'UNAUTHORIZED'}]`,
      );

      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication is required or the session has expired',
        requestId: reqId,
      });
    }

    return false;
  }

  private async trySupabaseIntrospection(request: FastifyRequest): Promise<GatewayClaims | null> {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') {
      return null;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      return null;
    }

    const claims = await this.supabaseTokenValidator.validateAccessToken(match[1].trim());
    if (claims) {
      this.logger.warn(
        `JWT strategy rejected bearer token for ${request.url}; accepted via Supabase introspection`,
      );
    }
    return claims;
  }
}
