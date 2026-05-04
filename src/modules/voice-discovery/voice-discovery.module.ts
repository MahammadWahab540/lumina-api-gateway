import { Module } from '@nestjs/common';
import { VoiceDiscoveryController } from './voice-discovery.controller';
import { VoiceDiscoveryService } from './voice-discovery.service';

@Module({
  controllers: [VoiceDiscoveryController],
  providers: [VoiceDiscoveryService],
})
export class VoiceDiscoveryModule {}
