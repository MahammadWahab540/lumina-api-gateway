import { All, Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayClaims } from '../auth/auth.types';
import { OpenMaicService } from './openmaic.service';
import { WarmupClassroomRequest } from './openmaic.types';
import { Public } from '../auth/public.decorator';

type GatewayRequest = FastifyRequest & { user: GatewayClaims };

@Controller('openmaic')
export class OpenMaicController {
  constructor(private readonly openMaicService: OpenMaicService) {}

  @Public()
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

  @Public()
  @All('proxy/*')
  async proxy(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const wildpath = (request.params as any)['*'];
    const result = await this.openMaicService.proxyRequest(
      wildpath,
      request.method,
      request.headers as any,
      request.body,
      request,
    );

    reply
      .status(result.status)
      .headers(result.headers)
      .send(result.body);
  }
}
