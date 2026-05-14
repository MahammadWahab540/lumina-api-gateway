import { Injectable, Inject, Logger, HttpException, ForbiddenException } from '@nestjs/common';
import { APP_CONFIG } from '../../../config/config.constants';
import { AppConfig } from '../../../config/config.types';
import { GatewayClaims } from '../../auth/auth.types';
import { SupabaseRealtimeService } from './supabase-realtime.service';
import * as crypto from 'crypto';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly realtimeService: SupabaseRealtimeService
  ) {}

  async startSession(claims: GatewayClaims, body: any) {
    const voiceSessionId = crypto.randomUUID();

    // Fetch active stage templates for tenant
    let stages = [];
    try {
      const response = await fetch(
        `${this.config.services.supabaseUrl}/rest/v1/onboarding_stage_templates?tenant_id=eq.${claims.tenantId}&is_active=eq.true&select=*&order=stage_index.asc`,
        {
          headers: {
            apikey: this.config.services.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.services.supabaseServiceRoleKey}`,
          },
        }
      );
      if (response.ok) {
        stages = await response.json();
      } else {
        this.logger.warn(`Failed to fetch templates: ${response.status}`);
      }
    } catch (e) {
      this.logger.error('Error fetching stage templates', e);
    }

    // Default template if missing
    if (!stages || stages.length === 0) {
      stages = [
        {
          id: 'WELCOME',
          system_prompt: `Hello {{user.first_name}}! Welcome. Let's get started.`,
          advance_when: { tool_called: 'advance_stage' },
          tools: ['advance_stage']
        }
      ];
    }

    // Replace user vars in system prompts
    const formattedStages = stages.map((stage: any) => {
      let prompt = stage.system_prompt || '';
      prompt = prompt.replace(/\\{\\{user\\.first_name\\}\\}/g, body.student_profile?.first_name || 'Student');
      return {
        id: stage.id,
        system_prompt: prompt,
        advance_when: stage.advance_when,
        tools: stage.tools
      };
    });

    const payload = {
      voice_session_id: voiceSessionId,
      user: {
        id: claims.userId,
        first_name: body.student_profile?.first_name,
        department: body.student_profile?.department,
        batch: body.student_profile?.batch,
        section: body.student_profile?.section,
        locale: body.locale || 'en-IN'
      },
      stages: formattedStages,
      tool_schemas: {
        save_answer: { fields: { key: 'string', value: 'any' } },
        advance_stage: { fields: {} }
      },
      callback_url: `${this.config.services.luminaGatewayUrl}/voice/onboarding/events`
    };

    try {
      const targetUrl = `${this.config.services.voiceDiscoveryServiceUrl}/sessions`;
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': this.config.services.voiceAgentInternalSecret
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpException(
          { code: 'VOICE_AGENT_ERROR', message: `Voice agent error: ${response.status} ${errorText}` },
          response.status >= 500 ? 502 : response.status
        );
      }

      const data = await response.json();
      return {
        voice_session_id: voiceSessionId,
        room_url: data.room_url,
        token: data.token,
        expires_at: data.expires_at
      };
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException({ code: 'VOICE_AGENT_UNAVAILABLE', message: e.message }, 502);
    }
  }

  async handleEvent(internalSecret: string, body: any) {
    if (internalSecret !== this.config.services.voiceAgentInternalSecret) {
      throw new ForbiddenException('Invalid internal secret');
    }

    const payload = {
      voice_session_id: body.voice_session_id,
      type: body.type,
      stage_id: body.stage_id,
      payload: body.payload,
      ts: body.ts || new Date().toISOString()
    };

    // Broadcast is handled elsewhere or via Supabase DB trigger.
    // Insert to DB using REST
    try {
      const response = await fetch(
        `${this.config.services.supabaseUrl}/rest/v1/onboarding_voice_events`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.config.services.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.services.supabaseServiceRoleKey}`,
            Prefer: 'return=minimal'
          },
          body: JSON.stringify([payload])
        }
      );
      if (!response.ok) {
        this.logger.warn(`Failed to persist voice event: ${await response.text()}`);
      }
    } catch (e) {
      this.logger.error('Error persisting voice event', e);
    }

    // Attempt broadcasting
    try {
       await this.realtimeService.broadcastEvent(body.voice_session_id, payload);
    } catch (e) {}

    return;
  }

  async endSession(claims: GatewayClaims, voiceSessionId: string) {
    if (!voiceSessionId) {
      throw new HttpException({ code: 'BAD_REQUEST', message: 'voice_session_id required' }, 400);
    }

    // Call Voice Agent DELETE
    try {
      await fetch(`${this.config.services.voiceDiscoveryServiceUrl}/sessions/${voiceSessionId}`, {
        method: 'DELETE',
        headers: {
          'x-internal-secret': this.config.services.voiceAgentInternalSecret
        }
      });
    } catch (e) {
      this.logger.warn(`Failed to delete session on voice agent: ${e}`);
    }

    // Mark as completed in Supabase
    try {
      await fetch(
        `${this.config.services.supabaseUrl}/rest/v1/onboarding_voice_sessions?voice_session_id=eq.${voiceSessionId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.config.services.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.services.supabaseServiceRoleKey}`,
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({ status: 'completed' })
        }
      );
    } catch (e) {
      this.logger.warn(`Failed to update session status: ${e}`);
    }

    return { status: 'completed', voice_session_id: voiceSessionId };
  }
}
