import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { SUPABASE_AUTH_STRATEGY } from './auth.constants';
import { GatewayClaims } from './auth.types';

function toRoleList(payload: Record<string, unknown>): string[] {
  const roleFromRoot = typeof payload.role === 'string' ? [payload.role] : [];
  const appMetadata = (payload.app_metadata ?? {}) as Record<string, unknown>;
  const roleFromArray = Array.isArray(appMetadata.roles)
    ? appMetadata.roles.filter((value): value is string => typeof value === 'string')
    : [];
  return Array.from(new Set([...roleFromRoot, ...roleFromArray]));
}

@Injectable()
export class SupabaseStrategy extends PassportStrategy(Strategy, SUPABASE_AUTH_STRATEGY) {
  private readonly logger = new Logger(SupabaseStrategy.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        cacheMaxEntries: 10,
        cacheMaxAge: 600000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: config.auth.jwksUri,
      }),
    });

    this.logger.log(
      `Registered auth strategy '${SUPABASE_AUTH_STRATEGY}' (issuer=${config.auth.issuer}, audience=${config.auth.audience})`,
    );
  }

  validate(payload: Record<string, unknown>): GatewayClaims {
    const userId = typeof payload.sub === 'string' ? payload.sub : undefined;

    if (!userId) {
      throw new UnauthorizedException('JWT payload is missing subject');
    }

    const appMetadata = (payload.app_metadata ?? {}) as Record<string, unknown>;
    const orgFromRoot = typeof payload.org_id === 'string' ? payload.org_id : undefined;
    const orgFromAppMetadata = typeof appMetadata.org_id === 'string' ? appMetadata.org_id : undefined;

    return {
      userId,
      orgId: orgFromRoot ?? orgFromAppMetadata,
      roles: toRoleList(payload),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      raw: payload,
    };
  }
}
