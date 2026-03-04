import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { HeaderScrubberInterceptor } from './common/interceptors/header-scrubber.interceptor';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { AppConfigurationModule } from './config/config.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';

@Module({
  imports: [AppConfigurationModule, AuthModule, RateLimitModule, HealthModule, ProxyModule],
  providers: [
    {
      provide: APP_GUARD,
      useExisting: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HeaderScrubberInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule { }
