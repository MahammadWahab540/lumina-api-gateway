import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';
import { GatewayClaims } from '../../modules/auth/auth.types';

type AuthenticatedRequest = FastifyRequest & { user?: GatewayClaims };

@Injectable()
export class ClaimsForwardingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const claims = request.user;

    if (!claims) {
      return next.handle();
    }

    request.headers['x-user-id'] = claims.userId;

    if (claims.orgId) {
      request.headers['x-org-id'] = claims.orgId;
    }

    if (claims.roles.length > 0) {
      request.headers['x-user-roles'] = claims.roles.join(',');
    }

    if (claims.email) {
      request.headers['x-user-email'] = claims.email;
    }

    if (request.raw?.headers) {
      request.raw.headers['x-user-id'] = claims.userId;
      if (claims.orgId) {
        request.raw.headers['x-org-id'] = claims.orgId;
      }
      if (claims.roles.length > 0) {
        request.raw.headers['x-user-roles'] = claims.roles.join(',');
      }
      if (claims.email) {
        request.raw.headers['x-user-email'] = claims.email;
      }
    }

    return next.handle();
  }
}
