import { Module } from '@nestjs/common';
import { AiProxyController, AuthProxyController, RestProxyController, StorageProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';

@Module({
  controllers: [AuthProxyController, AiProxyController, RestProxyController, StorageProxyController],
  providers: [ProxyService],
})
export class ProxyModule {}
