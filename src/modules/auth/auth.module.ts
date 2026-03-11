import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ClerkStrategy } from './clerk.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'clerk' })],
  providers: [ClerkStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
