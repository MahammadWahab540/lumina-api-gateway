import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';
import {
  AgentScopeSessionStatus,
  CreateVoiceSessionRequest,
  VoiceSessionCreatedResponse,
} from './voice-discovery.types';

@Injectable()
export class VoiceDiscoveryService {
  private readonly logger = new Logger(VoiceDiscoveryService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async createSession(
    claims: GatewayClaims,
    body: CreateVoiceSessionRequest,
  ): Promise<VoiceSessionCreatedResponse> {
    if (!body.projectContextId || !body.voiceSessionId) {
      throw new BadRequestException('Missing required fields: projectContextId, voiceSessionId');
    }

    const serviceKey = this.config.services.supabaseServiceRoleKey;
    const supabaseUrl = this.config.services.supabaseUrl;

    const [contextRows, uploads, questions] = await Promise.all([
      this.fetchSupabase<any[]>(
        `${supabaseUrl}/rest/v1/project_contexts?id=eq.${body.projectContextId}&user_id=eq.${claims.userId}&select=*`,
        serviceKey,
      ),
      this.fetchSupabase<any[]>(
        `${supabaseUrl}/rest/v1/project_uploads?user_id=eq.${claims.userId}&status=eq.ready&select=*`,
        serviceKey,
      ),
      this.fetchSupabase<any[]>(
        `${supabaseUrl}/rest/v1/discovery_questions?project_context_id=eq.${body.projectContextId}&user_id=eq.${claims.userId}&order=order_index.asc&select=*`,
        serviceKey,
      ),
    ]);

    if (!contextRows || contextRows.length === 0) {
      throw new BadRequestException('Project context not found or not ready');
    }

    const ctx = contextRows[0];
    const agentPayload = this.buildAgentPayload(claims, body, ctx, uploads ?? [], questions ?? []);

    const startedAt = Date.now();
    const agentResponse = await this.sendAgentRequest<{
      session_id: string;
      agentscope_session_id: string;
      ws_endpoint: string;
      context_items_loaded: number;
    }>('/sessions', { method: 'POST', body: JSON.stringify(agentPayload) });

    this.logger.log(
      JSON.stringify({
        msg: 'voice_session_created',
        sessionId: body.voiceSessionId,
        durationMs: Date.now() - startedAt,
      }),
    );

    // Update voice_sessions row in background (same pattern as openmaic.service.ts persistMetadata)
    this.patchVoiceSession(body.voiceSessionId, {
      agentscope_session_id: agentResponse.agentscope_session_id,
      ws_endpoint: agentResponse.ws_endpoint,
      status: 'active',
      started_at: new Date().toISOString(),
    }).catch((err) => this.logger.warn(`voice_sessions patch failed: ${err.message}`));

    return {
      sessionId: body.voiceSessionId,
      agentscopeSessionId: agentResponse.agentscope_session_id,
      wsEndpoint: agentResponse.ws_endpoint,
      status: 'initializing',
      contextItemsLoaded: agentResponse.context_items_loaded,
    };
  }

  async getSession(sessionId: string): Promise<AgentScopeSessionStatus> {
    return this.sendAgentRequest<AgentScopeSessionStatus>(`/sessions/${sessionId}`, {
      method: 'GET',
    });
  }

  async endSession(sessionId: string): Promise<void> {
    await this.sendAgentRequest<void>(`/sessions/${sessionId}`, { method: 'DELETE' });
  }

  private buildAgentPayload(
    claims: GatewayClaims,
    body: CreateVoiceSessionRequest,
    ctx: any,
    uploads: any[],
    questions: any[],
  ): Record<string, unknown> {
    const contextItems = (ctx.context_items ?? []).map((item: any) => {
      const upload = uploads.find((u: any) => u.id === item.upload_id);
      return {
        key: item.key,
        display_name: item.display_name,
        upload_id: item.upload_id ?? '',
        storage_path: upload?.storage_path ?? null,
        excerpt: item.excerpt ?? '',
      };
    });

    return {
      session_id: body.voiceSessionId,
      user_id: claims.userId,
      project_context_id: body.projectContextId,
      model_provider: body.modelProvider ?? 'gemini',
      session_config: {
        max_duration_seconds: body.sessionConfig?.maxDurationSeconds ?? 300,
        language: body.sessionConfig?.language ?? 'en',
        voice_mode: 'audio',
        agent_name: 'Discovery',
      },
      project_context: {
        project_summary: ctx.project_summary ?? '',
        tech_stack: ctx.tech_stack ?? {},
        identified_gaps: ctx.identified_gaps ?? [],
      },
      context_items: contextItems,
      discovery_questions: questions.map((q: any) => ({
        id: q.id,
        question_text: q.question_text,
        category: q.category ?? 'general',
        priority: q.priority ?? 1,
        context_item_refs: q.context_item_refs ?? [],
      })),
      supabase_callback: {
        url: this.config.services.supabaseUrl,
        service_role_key: this.config.services.supabaseServiceRoleKey,
        voice_session_id: body.voiceSessionId,
      },
    };
  }

  private async fetchSupabase<T>(url: string, serviceKey: string): Promise<T> {
    const resp = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      throw new BadGatewayException(`Supabase fetch failed: ${url}`);
    }
    return resp.json() as Promise<T>;
  }

  private async patchVoiceSession(
    voiceSessionId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const url = `${this.config.services.supabaseUrl}/rest/v1/voice_sessions?id=eq.${voiceSessionId}`;
    await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: this.config.services.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.services.supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
  }

  private buildAgentUrl(pathname: string): string {
    const base = this.config.services.voiceDiscoveryServiceUrl.replace(/\/+$/, '');
    return `${base}/${pathname.replace(/^\/+/, '')}`;
  }

  private async sendAgentRequest<T>(pathname: string, init: RequestInit): Promise<T> {
    const url = this.buildAgentUrl(pathname);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.services.proxyTimeoutMs);

    try {
      const resp = await fetch(url, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.config.services.internalServiceKey,
          ...(init.headers as Record<string, string> ?? {}),
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new HttpException(
          { code: 'VOICE_AGENT_UPSTREAM_ERROR', message: body },
          resp.status >= 500 ? 502 : resp.status,
        );
      }

      if (resp.status === 204) return undefined as T;
      return resp.json() as Promise<T>;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException('Voice discovery service timed out');
      }
      throw new BadGatewayException(
        error instanceof Error ? error.message : 'Voice discovery upstream failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
