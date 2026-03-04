import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_CONFIG } from './config.constants';
import { loadConfiguration } from './configuration';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfiguration(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigurationModule {}
