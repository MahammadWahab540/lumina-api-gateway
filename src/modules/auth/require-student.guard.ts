import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { GatewayClaims } from './auth.types';

@Injectable()
export class RequireStudentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: GatewayClaims }>();

    if (!request.user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!request.user.roles || !request.user.roles.includes('student')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Student role required to access this resource',
      });
    }

    return true;
  }
}
