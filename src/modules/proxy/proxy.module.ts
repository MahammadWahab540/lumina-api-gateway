import { Module } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import {
  AuthProxyController,
  AiProxyController,
  RestProxyController,
  StorageProxyController,
} from './proxy.controller';

@Module({
  controllers: [
    AuthProxyController,
    AiProxyController,
    RestProxyController,
    StorageProxyController,
  ],
  providers: [ProxyService],
})
export class ProxyModule {}
