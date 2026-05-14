import { FastifyRequest } from 'fastify';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';
import { CareerService } from './career.service';

function buildConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    logLevel: 'info',
    bodyLimitMb: 2,
    corsOrigins: ['*'],
    publicRoutes: ['/auth/login'],
    auth: {
      jwksUri: 'https://supabase.example/auth/v1/.well-known/jwks.json',
      issuer: 'https://supabase.example/auth/v1',
      audience: 'authenticated',
    },
    security: { allowedOrigins: ['*'] },
    redisUrl: 'redis://127.0.0.1:6379',
    services: {
      authServiceUrl: 'http://auth:3001',
      tenantServiceUrl: 'http://tenant:3001',
      userServiceUrl: 'http://user:3001',
      courseServiceUrl: 'http://course:3001',
      enrollmentServiceUrl: 'http://enrollment:3001',
      assignmentServiceUrl: 'http://assignment:3001',
      skillServiceUrl: 'http://skill:3001',
      aiServiceUrl: 'http://ai:3001',
      gamificationServiceUrl: 'http://gamification:3001',
      analyticsServiceUrl: 'http://analytics:3001',
      notificationServiceUrl: 'http://notification:3001',
      supabaseUrl: 'https://supabase.example',
      supabaseAnonKey: 'anon-key',
      supabaseServiceRoleKey: 'service-role',
      openmaicServiceUrl: 'http://openmaic:3001',
      personalizationServiceUrl: 'http://personalization:3001',
      careerServiceUrl: 'http://career:3013',
      internalServiceKey: 'internal-secret',
      luminaGatewayUrl: 'http://gateway:3000',
      voiceDiscoveryServiceUrl: 'http://voice:8002',
      voiceAgentInternalSecret: 'voice-secret',
      proxyTimeoutMs: 1000,
    },
    rateLimit: {
      global: { ttlMs: 60000, limit: 100, blockDurationMs: 60000 },
      auth: { ttlMs: 60000, limit: 30, blockDurationMs: 60000 },
      ai: { ttlMs: 60000, limit: 20, blockDurationMs: 60000 },
      career: { ttlMs: 60000, limit: 30, blockDurationMs: 60000 },
      rest: { ttlMs: 60000, limit: 60, blockDurationMs: 60000 },
      storage: { ttlMs: 60000, limit: 60, blockDurationMs: 60000 },
      openmaic: { ttlMs: 60000, limit: 600, blockDurationMs: 60000 },
      voice: { ttlMs: 60000, limit: 10, blockDurationMs: 60000 },
    },
  };
}

describe('CareerService', () => {
  it('strips spoofed identity headers and forwards trusted auth context headers', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    const claims: GatewayClaims = {
      userId: 'trusted-user',
      email: 'user@example.com',
      roles: ['student'],
      raw: {},
    };

    const service = new CareerService(buildConfig());
    const request = {
      id: 'req-1',
      headers: {
        authorization: 'Bearer token',
        'x-user-id': 'spoofed-user',
        'x-user-email': 'spoofed@example.com',
        'x-user-role': 'admin',
      },
      user: claims,
    } as unknown as FastifyRequest & { user: GatewayClaims };

    await service.forward(request, 'GET', '/opportunities');

    expect(global.fetch).toHaveBeenCalledWith(
      new URL('http://career:3013/opportunities'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-user-id': 'trusted-user',
          'x-user-email': 'user@example.com',
          'x-user-role': 'student',
          'x-request-id': 'req-1',
          'x-internal-key': 'internal-secret',
        }),
      }),
    );

    global.fetch = originalFetch;
  });
});
