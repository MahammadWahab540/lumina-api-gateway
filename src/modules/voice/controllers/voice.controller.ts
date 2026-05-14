import { Controller, Post, Body, Req, UseGuards, HttpCode, ForbiddenException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { VoiceService } from '../services/voice.service';
import { RequireStudentGuard } from '../../auth/require-student.guard';
import { GatewayClaims } from '../../auth/auth.types';

@Controller('voice/onboarding')
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  @UseGuards(RequireStudentGuard)
  @Post('start')
  @HttpCode(200)
  async start(
    @Req() request: FastifyRequest & { user: GatewayClaims },
    @Body() body: any
  ) {
    if (!body.tenant_id || !body.user_id) {
      throw new ForbiddenException({ code: 'BAD_REQUEST', message: 'Missing tenant_id or user_id in body' });
    }

    if (request.user.userId !== body.user_id || request.user.tenantId !== body.tenant_id) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'User mismatch or Tenant mismatch' });
    }

    return this.voiceService.startSession(request.user, body);
  }

  @Post('events')
  @HttpCode(204)
  async events(
    @Req() request: FastifyRequest,
    @Body() body: any
  ) {
    const internalSecret = request.headers['x-internal-secret'];
    return this.voiceService.handleEvent(internalSecret as string, body);
  }

  @UseGuards(RequireStudentGuard)
  @Post('end')
  @HttpCode(200)
  async end(
    @Req() request: FastifyRequest & { user: GatewayClaims },
    @Body() body: { voice_session_id: string }
  ) {
    return this.voiceService.endSession(request.user, body.voice_session_id);
  }
}
