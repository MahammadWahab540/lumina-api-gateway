import { FastifyRequest } from 'fastify';
import { AppConfig } from '../../config/config.types';
import { ProxyService } from './proxy.service';

function buildConfig(overrides?: Partial<AppConfig>): AppConfig {
  const base: AppConfig = {
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
    security: {
      allowedOrigins: ['*'],
    },
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
      personalizationServiceUrl: 'http://personalization:3001',
      proxyTimeoutMs: 1000,
    },
    rateLimit: {
      global: { ttlMs: 60000, limit: 100, blockDurationMs: 60000 },
      auth: { ttlMs: 60000, limit: 30, blockDurationMs: 60000 },
      ai: { ttlMs: 60000, limit: 20, blockDurationMs: 60000 },
      rest: { ttlMs: 60000, limit: 80, blockDurationMs: 60000 },
      storage: { ttlMs: 60000, limit: 60, blockDurationMs: 60000 },
    },
  };

  return {
    ...base,
    ...overrides,
    services: {
      ...base.services,
      ...overrides?.services,
    },
  };
}

describe('ProxyService', () => {
  const service = new ProxyService(buildConfig());

  it('maps rest and storage prefixes to Supabase endpoints', () => {
    expect((service as any).getTargetBase('rest')).toBe('https://supabase.example/rest/v1');
    expect((service as any).getTargetBase('storage')).toBe('https://supabase.example/storage/v1');
  });

  it('builds target urls preserving query string and stripping prefix', () => {
    const request = {
      raw: { url: '/rest/v1/todos?id=eq.123&select=*' },
      url: '/rest/v1/todos?id=eq.123&select=*',
    } as FastifyRequest;

    expect((service as any).buildTargetUrl('https://supabase.example/rest/v1', request, 'rest')).toBe(
      'https://supabase.example/rest/v1/todos?id=eq.123&select=*',
    );
  });

  it('builds storage target url stripping /storage/v1 prefix', () => {
    const request = {
      raw: { url: '/storage/v1/object/public/bucket/file.png?download=true' },
      url: '/storage/v1/object/public/bucket/file.png?download=true',
    } as FastifyRequest;

    expect((service as any).buildTargetUrl('https://supabase.example/storage/v1', request, 'storage')).toBe(
      'https://supabase.example/storage/v1/object/public/bucket/file.png?download=true',
    );
  });

  it('injects apikey for Supabase targets and strips spoofed identity headers', () => {
    const request = {
      id: 'req-1',
      headers: {},
      user: { userId: 'user-1', orgId: 'org-1', roles: ['student'], email: 'x@example.com' },
    } as unknown as FastifyRequest;

    const rewritten = (service as any).rewriteRequestHeaders(
      {
        host: 'gateway.example',
        authorization: 'Bearer token',
        'x-user-id': 'spoofed',
        'x-org-id': 'spoofed',
      },
      request,
      'rest',
    );

    expect(rewritten.authorization).toBe('Bearer token');
    expect(rewritten['x-user-id']).toBe('user-1');
    expect(rewritten['x-org-id']).toBe('org-1');
    expect(rewritten.apikey).toBe('anon-key');
    expect(rewritten.host).toBeUndefined();
  });

  it('returns a structured 503 when a proxied service is not configured', () => {
    const missingTargetService = new ProxyService(
      buildConfig({
        services: {
          ...buildConfig().services,
          aiServiceUrl: undefined as unknown as string,
        },
      }),
    );

    const request = {
      id: 'req-2',
      headers: {},
      raw: { url: '/ai/infer' },
      url: '/ai/infer',
    } as unknown as FastifyRequest;
    const code = jest.fn().mockReturnThis();
    const send = jest.fn();
    const reply = {
      sent: false,
      code,
      send,
      from: jest.fn(),
    };

    missingTargetService.forward(request, reply as any, 'ai');

    expect(reply.from).not.toHaveBeenCalled();
    expect(code).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'UPSTREAM_NOT_CONFIGURED',
        requestId: 'req-2',
      }),
    );
  });
});
