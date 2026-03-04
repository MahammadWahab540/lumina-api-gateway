import { All, Controller, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ProxyService } from './proxy.service';

@Controller('auth')
export class AuthProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @All()
  proxyAuthRoot(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    this.proxyService.forward(request, reply, 'auth');
  }

  @All(':path*')
  proxyAuthPath(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    this.proxyService.forward(request, reply, 'auth');
  }
}

@Controller('ai')
export class AiProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @All()
  proxyAiRoot(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    this.proxyService.forward(request, reply, 'ai');
  }

  @All(':path*')
  proxyAiPath(@Req() request: FastifyRequest, @Res() reply: FastifyReply): void {
    this.proxyService.forward(request, reply, 'ai');
  }
}
