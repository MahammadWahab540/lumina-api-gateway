import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from './auth.types';

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

@Injectable()
export class ClerkStrategy extends PassportStrategy(Strategy, 'clerk') {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer: config.auth.issuer,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        cacheMaxEntries: 10,
        cacheMaxAge: 600000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: config.auth.jwksUri,
      }),
    });
  }

  validate(payload: Record<string, unknown>): GatewayClaims {
    const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!userId) {
      throw new UnauthorizedException('JWT payload is missing subject');
    }

    const publicMetadata = (payload.public_metadata ?? {}) as Record<string, unknown>;
    const orgId = typeof publicMetadata.organization_id === 'string' ? publicMetadata.organization_id : undefined;

    return {
      userId,
      orgId,
      roles: toStringList(publicMetadata.roles),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      raw: payload,
    };
  }
}
