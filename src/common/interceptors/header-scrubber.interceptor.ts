import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';

const SENSITIVE_HEADERS = ['x-user-id', 'x-org-id', 'x-user-roles', 'x-user-email'];

@Injectable()
export class HeaderScrubberInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    for (const header of SENSITIVE_HEADERS) {
      delete request.headers[header];
      if (request.raw?.headers) {
        delete request.raw.headers[header];
      }
    }

    return next.handle();
  }
}
