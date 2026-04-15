import { All, Controller, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { OpenMaicService } from './openmaic.service';

/**
 * This controller handles global static assets required by the OpenMAIC UI 
 * when it is rendered through the Gateway's proxy.
 * 
 * Next.js assets are typically requested at /_next/* or /public/* from the domain root.
 */
@Controller()
export class OpenMaicAssetsController {
  constructor(private readonly openMaicService: OpenMaicService) {}

  @All('_next/*')
  async proxyNext(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.handleProxy(request, reply);
  }

  @All('public/*')
  async proxyPublic(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.handleProxy(request, reply);
  }

  /**
   * Internal helper to route static asset requests to the OpenMaicService proxy logic
   */
  private async handleProxy(request: FastifyRequest, reply: FastifyReply) {
    // The url here includes the leading slash (e.g., /_next/static/...)
    // Our service expects the path relative to the base URL.
    const path = request.url.replace(/^\/+/, '');
    
    const result = await this.openMaicService.proxyRequest(
      path,
      request.method,
      request.headers as any,
      request.body,
    );

    reply
      .status(result.status)
      .headers(result.headers)
      .send(result.body);
  }
}
