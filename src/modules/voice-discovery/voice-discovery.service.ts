import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';
import {
  AgentScopeSessionStatus,
  CreateVoiceSessionRequest,
  VoiceDiscoveryHealth,
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

    this.logger.log(`[VoiceDiscovery] Create requested: userId=${claims.userId} sessionId=${body.voiceSessionId} contextId=${body.projectContextId}`);

    this.assertServiceRoleConfigured();

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

    this.logger.log(`[VoiceDiscovery] Supabase data fetched: contexts=${contextRows?.length}, uploads=${uploads?.length}, questions=${questions?.length}`);

    if (!contextRows || contextRows.length === 0) {
      this.logger.warn(`[VoiceDiscovery] Context not found for id=${body.projectContextId} and userId=${claims.userId}`);
      throw new BadRequestException('Project context not found or not ready');
    }

    const ctx = contextRows[0];
    const agentPayload = this.buildAgentPayload(claims, body, ctx, uploads ?? [], questions ?? []);
    this.logger.log(`[VoiceDiscovery] Sending request to agent service: ${body.voiceSessionId}`);

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

  async createAssignmentSession(
    claims: GatewayClaims,
    authToken: string | undefined,
    body: import('./voice-discovery.types').CreateAssignmentVoiceSessionRequest,
  ): Promise<VoiceSessionCreatedResponse> {
    if (!body.assignmentId) {
      throw new BadRequestException('Missing required fields: assignmentId');
    }

    this.assertServiceRoleConfigured();

    const anonKey = this.config.services.supabaseAnonKey || this.config.services.supabaseServiceRoleKey;
    const supabaseUrl = this.config.services.supabaseUrl;

    const [assignments, submissions] = await Promise.all([
      this.fetchSupabase<any[]>(
        `${supabaseUrl}/rest/v1/assignments?id=eq.${body.assignmentId}&select=title,description`,
        anonKey,
        authToken
      ),
      this.fetchSupabase<any[]>(
        `${supabaseUrl}/rest/v1/assignment_submissions?assignment_id=eq.${body.assignmentId}&user_id=eq.${claims.userId}&select=submission_text`,
        anonKey,
        authToken
      ),
    ]);

    if (!assignments || assignments.length === 0) {
      throw new BadRequestException('Assignment not found');
    }
    if (!submissions || submissions.length === 0) {
      throw new BadRequestException('Submission not found');
    }

    const assignment = assignments[0];
    const submission = submissions[0];
    const voiceSessionId = body.voiceSessionId ?? await this.createVoiceSessionForAssignment(claims.userId, body.assignmentId, body.modelProvider ?? 'gemini');

    const agentPayload = {
      session_id: voiceSessionId,
      user_id: claims.userId,
      project_context_id: `assignment-${body.assignmentId}`,
      model_provider: body.modelProvider ?? 'gemini',
      session_config: {
        max_duration_seconds: body.sessionConfig?.maxDurationSeconds ?? 300,
        language: body.sessionConfig?.language ?? 'en',
        voice_mode: 'audio',
        agent_name: 'Defense Panel',
      },
      project_context: {
        project_summary: `The student has submitted work for the assignment: ${assignment.title}. Your job is to conduct an oral defense and ask them to explain their code and reasoning.`,
        tech_stack: { languages: [], frameworks: [], databases: [], infrastructure: [] },
        identified_gaps: [],
      },
      context_items: [
        {
          key: 'assignment_prompt',
          display_name: 'Assignment Prompt',
          upload_id: '',
          storage_path: null,
          excerpt: assignment.description || 'No description provided.',
        },
        {
          key: 'student_submission',
          display_name: 'Student Submission',
          upload_id: '',
          storage_path: null,
          excerpt: submission.submission_text || 'No submission text.',
        }
      ],
      discovery_questions: [
        {
          id: 'q1',
          question_text: 'Can you walk me through your overall approach to solving this assignment?',
          category: 'general',
          priority: 1,
          context_item_refs: ['student_submission'],
        },
        {
          id: 'q2',
          question_text: 'What was the most challenging part of this assignment, and how did you overcome it?',
          category: 'technical',
          priority: 2,
          context_item_refs: [],
        },
        {
          id: 'q3',
          question_text: 'If you had more time, how would you optimize or improve your solution?',
          category: 'optimization',
          priority: 3,
          context_item_refs: ['student_submission'],
        }
      ],
      supabase_callback: {
        url: this.config.services.supabaseUrl,
        service_role_key: this.config.services.supabaseServiceRoleKey,
        voice_session_id: voiceSessionId,
      },
    };

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
        sessionId: voiceSessionId,
        type: 'assignment',
        durationMs: Date.now() - startedAt,
      }),
    );

    await this.patchVoiceSession(voiceSessionId, {
      agentscope_session_id: agentResponse.agentscope_session_id,
      ws_endpoint: agentResponse.ws_endpoint,
      status: 'active',
      started_at: new Date().toISOString(),
    });

    return {
      sessionId: voiceSessionId,
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

  async healthCheck(): Promise<VoiceDiscoveryHealth> {
    try {
      const resp = await this.sendAgentRequest<Record<string, unknown> & { status?: string }>('/health', {
        method: 'GET',
      });
      return {
        healthy: resp?.status === 'ok',
        status: resp?.status === 'ok' ? 'ok' : 'error',
        providers: resp?.providers as Record<string, boolean> | undefined,
        pool: resp?.pool as Record<string, unknown> | undefined,
      };
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error?.message || 'Unknown error'}`);
      return { healthy: false, status: 'error' };
    }
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

  private async fetchSupabase<T>(url: string, apikey: string, authToken?: string): Promise<T> {
    try {
      const resp = await fetch(url, {
        headers: {
          apikey: apikey,
          Authorization: authToken ?? `Bearer ${apikey}`,
          Accept: 'application/json',
        },
      });
      if (!resp.ok) {
        throw new BadGatewayException(`Supabase fetch failed: ${url}`);
      }
      return resp.json() as Promise<T>;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      this.logger.error(`fetchSupabase failed: url=${url} error=${error instanceof Error ? error.stack : error}`);
      throw new BadGatewayException(`fetchSupabase: fetch failed`);
    }
  }

  private assertServiceRoleConfigured(): void {
    const key = (this.config.services.supabaseServiceRoleKey || '').trim();
    if (!key || key.startsWith('your-') || key.startsWith('your_') || key.includes('<') || key === 'test-key') {
      throw new ServiceUnavailableException({
        code: 'VOICE_DISCOVERY_SUPABASE_SERVICE_ROLE_MISSING',
        message: 'SUPABASE_SERVICE_ROLE_KEY must be configured for voice discovery sessions.',
      });
    }
  }

  private async createVoiceSessionForAssignment(
    userId: string,
    assignmentId: string,
    modelProvider: 'gemini' | 'openai' | 'dashscope',
  ): Promise<string> {
    const url = `${this.config.services.supabaseUrl}/rest/v1/voice_sessions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: this.config.services.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.services.supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId,
        assignment_id: assignmentId,
        model_provider: modelProvider,
        status: 'initializing',
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new BadGatewayException(`voice_sessions insert failed: ${body}`);
    }

    const rows = await resp.json() as Array<{ id: string }>;
    const id = rows[0]?.id;
    if (!id) {
      throw new BadGatewayException('voice_sessions insert did not return an id');
    }
    return id;
  }

  private async patchVoiceSession(
    voiceSessionId: string,
    patch: Record<string, unknown>,
    authToken?: string
  ): Promise<void> {
    const apikey = this.config.services.supabaseAnonKey || this.config.services.supabaseServiceRoleKey;
    const url = `${this.config.services.supabaseUrl}/rest/v1/voice_sessions?id=eq.${voiceSessionId}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: this.config.services.supabaseServiceRoleKey || apikey,
        Authorization: authToken ?? `Bearer ${this.config.services.supabaseServiceRoleKey || apikey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new BadGatewayException(`voice_sessions patch failed: ${body}`);
    }
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
      this.logger.error(`sendAgentRequest fetch failed: url=${url} error=${error instanceof Error ? error.stack : error}`);
      throw new BadGatewayException(
        error instanceof Error ? `sendAgentRequest: ${error.message}` : 'Voice discovery upstream failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
