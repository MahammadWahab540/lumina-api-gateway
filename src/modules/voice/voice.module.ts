import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VoiceDiscoveryModule } from '../voice-discovery/voice-discovery.module';
import { VoiceController } from './controllers/voice.controller';
import { VoiceService } from './services/voice.service';
import { SupabaseRealtimeService } from './services/supabase-realtime.service';

@Module({
  imports: [AuthModule, VoiceDiscoveryModule],
  controllers: [VoiceController],
  providers: [VoiceService, SupabaseRealtimeService],
  exports: [VoiceService],
})
export class VoiceModule {}
