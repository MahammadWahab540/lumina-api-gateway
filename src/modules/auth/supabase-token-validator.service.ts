import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
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
export class SupabaseTokenValidatorService {
  private readonly logger = new Logger(SupabaseTokenValidatorService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async validateAccessToken(accessToken: string): Promise<GatewayClaims | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.services.proxyTimeoutMs);

    try {
      const response = await fetch(`${this.config.services.supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: this.config.services.supabaseAnonKey,
          authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const userId = payload && typeof payload.id === 'string' ? payload.id : undefined;

      if (!userId) {
        this.logger.warn('Supabase token introspection returned a user without an id');
        return null;
      }

      const appMetadata = ((payload?.app_metadata as Record<string, unknown> | undefined) ?? {});
      const orgFromRoot = payload && typeof payload.org_id === 'string' ? payload.org_id : undefined;
      const orgFromAppMetadata =
        typeof appMetadata.org_id === 'string' ? appMetadata.org_id : undefined;

      return {
        userId,
        orgId: orgFromRoot ?? orgFromAppMetadata,
        roles: toRoleList(payload ?? {}),
        email: payload && typeof payload.email === 'string' ? payload.email : undefined,
        raw: payload ?? {},
      };
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        this.logger.warn(
          `Supabase token introspection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
