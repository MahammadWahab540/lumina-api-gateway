import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';

export interface AuthContextResponse {
  profile: Record<string, unknown> | null;
  roles: Record<string, unknown>[];
}

@Injectable()
export class AuthContextService {
  private readonly logger = new Logger(AuthContextService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async getContext(
    userId: string,
    accessToken: string,
    requestId?: string,
  ): Promise<AuthContextResponse> {
    try {
      const rpcResponse = await this.fetchSupabase(
        '/rest/v1/rpc/get_user_context',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ p_user_id: userId }),
        },
        requestId,
      );

      if (rpcResponse.ok) {
        return this.normalizeRpcPayload(await rpcResponse.json());
      }

      this.logger.warn(
        `Supabase RPC get_user_context failed with status=${rpcResponse.status}, falling back to table reads`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Supabase RPC get_user_context failed: ${message}`);
    }

    try {
      const [profile, roles] = await Promise.all([
        this.fetchProfile(userId, accessToken, requestId),
        this.fetchRoles(userId, accessToken, requestId),
      ]);

      return { profile, roles };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException({
        code: 'AUTH_CONTEXT_FETCH_FAILED',
        message: 'Unable to load auth context from Supabase',
        details: { reason: message },
      });
    }
  }

  private async fetchProfile(
    userId: string,
    accessToken: string,
    requestId?: string,
  ): Promise<Record<string, unknown> | null> {
    const params = new URLSearchParams({
      select:
        'id,email,full_name,avatar_url,organization_id,onboarding_completed,career_goal',
      id: `eq.${userId}`,
    });
    const response = await this.fetchSupabase(
      `/rest/v1/profiles?${params.toString()}`,
      accessToken,
      { method: 'GET' },
      requestId,
    );

    if (!response.ok) {
      throw new Error(`profiles query failed with status=${response.status}`);
    }

    const payload = await response.json();
    return Array.isArray(payload) ? (payload[0] ?? null) : (payload ?? null);
  }

  private async fetchRoles(
    userId: string,
    accessToken: string,
    requestId?: string,
  ): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({
      select: '*',
      user_id: `eq.${userId}`,
    });
    const response = await this.fetchSupabase(
      `/rest/v1/user_roles?${params.toString()}`,
      accessToken,
      { method: 'GET' },
      requestId,
    );

    if (!response.ok) {
      throw new Error(`user_roles query failed with status=${response.status}`);
    }

    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  }

  private async fetchSupabase(
    path: string,
    accessToken: string,
    init: RequestInit,
    requestId?: string,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('apikey', this.config.services.supabaseAnonKey);
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (!headers.has('Content-Type') && init.method !== 'GET') {
      headers.set('Content-Type', 'application/json');
    }
    if (requestId) {
      headers.set('x-request-id', requestId);
    }

    return fetch(new URL(path, this.config.services.supabaseUrl).toString(), {
      ...init,
      headers,
    });
  }

  private normalizeRpcPayload(payload: unknown): AuthContextResponse {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { profile: null, roles: [] };
    }

    const record = payload as Record<string, unknown>;
    return {
      profile:
        record.profile && typeof record.profile === 'object' && !Array.isArray(record.profile)
          ? (record.profile as Record<string, unknown>)
          : null,
      roles: Array.isArray(record.roles)
        ? record.roles.filter(
            (role): role is Record<string, unknown> =>
              typeof role === 'object' && role !== null && !Array.isArray(role),
          )
        : [],
    };
  }
}
