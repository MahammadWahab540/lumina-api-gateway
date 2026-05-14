import { Module } from '@nestjs/common';
import { VoiceController } from './controllers/voice.controller';
import { VoiceService } from './services/voice.service';
import { SupabaseRealtimeService } from './services/supabase-realtime.service';

@Module({
  controllers: [VoiceController],
  providers: [VoiceService, SupabaseRealtimeService],
  exports: [VoiceService]
})
export class VoiceModule {}
