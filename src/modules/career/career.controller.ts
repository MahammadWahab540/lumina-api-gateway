import { All, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayClaims } from '../auth/auth.types';
import { CareerService } from './career.service';

type GatewayRequest = FastifyRequest & { user: GatewayClaims };

@Controller('career')
export class CareerController {
  constructor(private readonly careerService: CareerService) {}

  @Post('resumes')
  async createResume(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Body() body: unknown) {
    const result = await this.careerService.forward(request, 'POST', '/resumes', body);
    reply.status(result.statusCode).send(result.body);
  }

  @Get('resumes/:resumeId')
  async getResume(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('resumeId') resumeId: string) {
    const result = await this.careerService.forward(request, 'GET', `/resumes/${resumeId}`);
    reply.status(result.statusCode).send(result.body);
  }

  @Post('resumes/:resumeId/parse')
  async parseResume(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('resumeId') resumeId: string) {
    const result = await this.careerService.forward(request, 'POST', `/resumes/${resumeId}/parse`);
    reply.status(result.statusCode).send(result.body);
  }

  @Post('resumes/:resumeId/retry')
  async retryResume(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('resumeId') resumeId: string) {
    const result = await this.careerService.forward(request, 'POST', `/resumes/${resumeId}/retry`);
    reply.status(result.statusCode).send(result.body);
  }

  @Delete('resumes/:resumeId')
  async deleteResume(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('resumeId') resumeId: string) {
    const result = await this.careerService.forward(request, 'DELETE', `/resumes/${resumeId}`);
    reply.status(result.statusCode).send(result.body);
  }

  @Post('discovery/run')
  async createDiscoveryRun(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Body() body: unknown) {
    const result = await this.careerService.forward(request, 'POST', '/discovery/run', body);
    reply.status(result.statusCode).send(result.body);
  }

  @Get('discovery/runs/:id')
  async getDiscoveryRun(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('id') id: string) {
    const result = await this.careerService.forward(request, 'GET', `/discovery/runs/${id}`);
    reply.status(result.statusCode).send(result.body);
  }

  @Get('discovery/runs/:id/jobs')
  async getDiscoveryRunJobs(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('id') id: string) {
    const result = await this.careerService.forward(request, 'GET', `/discovery/runs/${id}/jobs`);
    reply.status(result.statusCode).send(result.body);
  }

  @Post('discovery/runs/:id/retry')
  async retryDiscoveryRun(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('id') id: string) {
    const result = await this.careerService.forward(request, 'POST', `/discovery/runs/${id}/retry`);
    reply.status(result.statusCode).send(result.body);
  }

  @Post('discovery/runs/:id/cancel')
  async cancelDiscoveryRun(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('id') id: string) {
    const result = await this.careerService.forward(request, 'POST', `/discovery/runs/${id}/cancel`);
    reply.status(result.statusCode).send(result.body);
  }

  @Get('opportunities')
  async getOpportunities(
    @Req() request: GatewayRequest,
    @Res() reply: FastifyReply,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const result = await this.careerService.forward(request, 'GET', '/opportunities', undefined, { status, limit, cursor });
    reply.status(result.statusCode).send(result.body);
  }

  @Get('opportunities/:id')
  async getOpportunity(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('id') id: string) {
    const result = await this.careerService.forward(request, 'GET', `/opportunities/${id}`);
    reply.status(result.statusCode).send(result.body);
  }

  @Patch('opportunities/:id/status')
  async updateOpportunityStatus(
    @Req() request: GatewayRequest,
    @Res() reply: FastifyReply,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const result = await this.careerService.forward(request, 'PATCH', `/opportunities/${id}/status`, body);
    reply.status(result.statusCode).send(result.body);
  }

  @Post('opportunities/:id/resume')
  async generateResume(
    @Req() request: GatewayRequest,
    @Res() reply: FastifyReply,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const result = await this.careerService.forward(request, 'POST', `/opportunities/${id}/resume`, body);
    reply.status(result.statusCode).send(result.body);
  }

  @Get('resumes/:resumeId/download')
  async downloadResume(@Req() request: GatewayRequest, @Res() reply: FastifyReply, @Param('resumeId') resumeId: string) {
    const result = await this.careerService.forward(request, 'GET', `/resumes/${resumeId}/download`);
    reply.status(result.statusCode).send(result.body);
  }

  @All(':path*')
  async unsupported(@Res() reply: FastifyReply) {
    reply.status(404).send({
      code: 'NOT_FOUND',
      message: 'Unsupported career route',
    });
  }
}
