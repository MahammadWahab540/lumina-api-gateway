import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { GatewayClaims } from '../auth/auth.types';
import { CreateVoiceSessionRequest, VoiceSessionCreatedResponse } from './voice-discovery.types';
import { VoiceDiscoveryService } from './voice-discovery.service';

type GatewayRequest = FastifyRequest & { user: GatewayClaims };

@Controller('voice-discovery')
export class VoiceDiscoveryController {
  constructor(private readonly service: VoiceDiscoveryService) {}

  @Post('sessions')
  @HttpCode(201)
  createSession(
    @Req() request: GatewayRequest,
    @Body() body: CreateVoiceSessionRequest,
  ): Promise<VoiceSessionCreatedResponse> {
    return this.service.createSession(request.user, body);
  }

  @Get('sessions/:sessionId')
  getSession(@Param('sessionId') sessionId: string) {
    return this.service.getSession(sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  endSession(@Param('sessionId') sessionId: string): Promise<void> {
    return this.service.endSession(sessionId);
  }
}
