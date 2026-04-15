import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SUPABASE_AUTH_STRATEGY } from './auth.constants';
import { SupabaseStrategy } from './supabase.strategy';
import { SupabaseTokenValidatorService } from './supabase-token-validator.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [PassportModule.register({ defaultStrategy: SUPABASE_AUTH_STRATEGY })],
  providers: [SupabaseStrategy, SupabaseTokenValidatorService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
