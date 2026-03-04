import { Module } from '@nestjs/common';
import { AiProxyController, AuthProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';

@Module({
  controllers: [AuthProxyController, AiProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
