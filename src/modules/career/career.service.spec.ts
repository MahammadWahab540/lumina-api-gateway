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
      openmaicEmbedSigningSecret: 'signing-secret-placeholder',
      openmaicEmbedTtlSeconds: 900,
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('strips spoofed identity headers and forwards trusted auth context headers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    } as Response);

    const claims: GatewayClaims = {
      userId: 'trusted-user',
      email: 'user@example.com',
      roles: ['student', 'mentor'],
      tenantId: 'trusted-tenant',
      orgId: 'trusted-org',
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
        'x-user-roles': 'admin,platform_owner',
        'x-org-id': 'spoofed-org',
        'x-tenant-id': 'spoofed-tenant',
        'x-internal-key': 'spoofed-internal-key',
      },
      user: claims,
    } as unknown as FastifyRequest & { user: GatewayClaims };

    await service.forward(request, 'GET', '/opportunities');

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://career:3013/opportunities'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-user-id': 'trusted-user',
          'x-user-email': 'user@example.com',
          'x-user-role': 'student',
          'x-user-roles': 'student,mentor',
          'x-org-id': 'trusted-org',
          'x-tenant-id': 'trusted-tenant',
          'x-request-id': 'req-1',
          'x-internal-key': 'internal-secret',
        }),
      }),
    );
  });

  it('maps upstream timeouts to a safe 504 response', async () => {
    const timeout = new Error('sensitive upstream timeout details');
    timeout.name = 'TimeoutError';
    jest.spyOn(global, 'fetch').mockRejectedValue(timeout);

    const service = new CareerService(buildConfig());
    const request = {
      id: 'req-timeout',
      headers: {},
      user: { userId: 'trusted-user', roles: ['student'], raw: {} },
    } as unknown as FastifyRequest & { user: GatewayClaims };

    await expect(service.forward(request, 'POST', '/discovery/run', {})).resolves.toEqual({
      statusCode: 504,
      body: {
        code: 'CAREER_SERVICE_TIMEOUT',
        message: 'Career service request timed out',
        request_id: 'req-timeout',
      },
    });
  });
});
