import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { GatewayClaims } from './auth.types';
import { AuthContextResponse, AuthContextService } from './auth-context.service';

type AuthenticatedRequest = FastifyRequest & {
  user?: GatewayClaims;
};

@Controller('auth')
export class AuthContextController {
  constructor(private readonly authContextService: AuthContextService) {}

  @Get('context')
  async getContext(@Req() request: AuthenticatedRequest): Promise<AuthContextResponse> {
    const claims = request.user;
    if (!claims?.userId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    const authorization = request.headers.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const accessToken = authorization.slice('Bearer '.length).trim();
    if (!accessToken) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return this.authContextService.getContext(claims.userId, accessToken, request.id);
  }
}
