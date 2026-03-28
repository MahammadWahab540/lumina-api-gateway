import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthContextController } from './auth-context.controller';
import { AuthContextService } from './auth-context.service';
import { SUPABASE_AUTH_STRATEGY } from './auth.constants';
import { SupabaseStrategy } from './supabase.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [PassportModule.register({ defaultStrategy: SUPABASE_AUTH_STRATEGY })],
  controllers: [AuthContextController],
  providers: [SupabaseStrategy, JwtAuthGuard, AuthContextService],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
