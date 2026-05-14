import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG } from '../../../config/config.constants';
import { AppConfig } from '../../../config/config.types';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

@Injectable()
export class SupabaseRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupabaseRealtimeService.name);
  private supabase: SupabaseClient | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    if (this.config.services.supabaseUrl && this.config.services.supabaseServiceRoleKey && !this.config.services.supabaseServiceRoleKey.includes('<')) {
      try {
        this.supabase = createClient(this.config.services.supabaseUrl, this.config.services.supabaseServiceRoleKey, {
          auth: { persistSession: false }
        });
        this.logger.log('Supabase Realtime Client initialized.');
      } catch (e) {
        this.logger.warn('Failed to initialize Supabase client for realtime');
      }
    } else {
      this.logger.warn('Missing SUPABASE_SERVICE_ROLE_KEY - Realtime broadcast disabled');
    }
  }

  onModuleDestroy() {
    if (this.supabase) {
      this.supabase.removeAllChannels();
    }
  }

  async broadcastEvent(voiceSessionId: string, eventData: any) {
    if (!this.supabase) {
      this.logger.warn('Supabase client not initialized. Cannot broadcast event.');
      return;
    }

    try {
      const channelName = `voice:${voiceSessionId}`;
      const channel = this.supabase.channel(channelName);

      await channel.send({
        type: 'broadcast',
        event: 'voice_event',
        payload: eventData,
      });

      // Cleanup channel immediately after sending
      this.supabase.removeChannel(channel);

    } catch (e) {
      this.logger.error(`Failed to broadcast event to voice:${voiceSessionId}`, e);
    }
  }
}
