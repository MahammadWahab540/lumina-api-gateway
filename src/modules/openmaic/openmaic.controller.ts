import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { GatewayClaims } from '../auth/auth.types';
import { OpenMaicService } from './openmaic.service';
import { WarmupClassroomRequest } from './openmaic.types';

type GatewayRequest = FastifyRequest & { user: GatewayClaims };

@Controller('openmaic/classrooms')
export class OpenMaicController {
  constructor(private readonly openMaicService: OpenMaicService) {}

  @Post('warmup')
  @HttpCode(200)
  warmup(@Req() request: GatewayRequest, @Body() body: WarmupClassroomRequest) {
    return this.openMaicService.warmup(request.user, body, request);
  }

  @Get('stages/:stageId')
  getStage(@Req() request: GatewayRequest, @Param('stageId') stageId: string) {
    return this.openMaicService.getStage(stageId, request);
  }

  @Post('stages/:stageId/regenerate')
  @HttpCode(200)
  regenerate(
    @Req() request: GatewayRequest,
    @Param('stageId') stageId: string,
    @Body() body: Omit<WarmupClassroomRequest, 'stageId'>,
  ) {
    return this.openMaicService.regenerate(request.user, stageId, body, request);
  }
}
