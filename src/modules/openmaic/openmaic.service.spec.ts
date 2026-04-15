import { HttpException, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';
import { OpenMaicService } from './openmaic.service';

function buildConfig(
  overrides: Partial<AppConfig['services']> = {},
): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    logLevel: 'silent',
    bodyLimitMb: 2,
    corsOrigins: ['*'],
    publicRoutes: ['/auth/login'],
    auth: {
      jwksUri: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
    },
    security: {
      allowedOrigins: ['*'],
    },
    redisUrl: 'redis://127.0.0.1:6379',
    services: {
      authServiceUrl: 'http://127.0.0.1:3001',
      tenantServiceUrl: 'http://127.0.0.1:3003',
      userServiceUrl: 'http://127.0.0.1:3004',
      courseServiceUrl: 'http://127.0.0.1:3005',
      enrollmentServiceUrl: 'http://127.0.0.1:3006',
      assignmentServiceUrl: 'http://127.0.0.1:3007',
      skillServiceUrl: 'http://127.0.0.1:3008',
      aiServiceUrl: 'http://127.0.0.1:3002',
      gamificationServiceUrl: 'http://127.0.0.1:3009',
      analyticsServiceUrl: 'http://127.0.0.1:3010',
      notificationServiceUrl: 'http://127.0.0.1:3011',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
      supabaseServiceRoleKey: 'service-role-key',
      openmaicServiceUrl: 'https://openmaic.example',
      personalizationServiceUrl: 'http://127.0.0.1:3012',
      proxyTimeoutMs: 1000,
      ...overrides,
    },
    rateLimit: {
      global: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      auth: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      ai: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      rest: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      storage: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      openmaic: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('OpenMaicService', () => {
  const claims: GatewayClaims = {
    userId: 'user-123',
    orgId: 'org-456',
    roles: ['teacher'],
    email: 'teacher@example.com',
    raw: { sub: 'user-123' },
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('forwards x-forwarded headers and joins upstream URLs with the URL API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      jsonResponse({
        status: 'ready',
        stageId: 'stage-1',
        classroomId: 'classroom-1',
      }),
    );

    const service = new OpenMaicService(
      buildConfig({
        openmaicServiceUrl: 'https://openmaic.example/base/',
        supabaseServiceRoleKey: '<your-supabase-service-role-key>',
      }),
    );

    await (service as any).warmup(
      claims,
      {
        stageId: 'stage-1',
        topic: 'Gravity',
      } as never,
      {
        headers: {
          'x-forwarded-host': 'classroom.lumina.test',
          'x-forwarded-proto': 'https',
        },
      } as never,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://openmaic.example/base/api/pathwisse/classrooms/warmup',
    );

    const options = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = options.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-forwarded-host')).toBe('classroom.lumina.test');
    expect(headers.get('x-forwarded-proto')).toBe('https');
  });

  it('passes through upstream error details and status codes', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      jsonResponse(
        {
          error: 'Classroom unavailable',
          details: { stageId: 'stage-1' },
        },
        404,
      ),
    );

    const service = new OpenMaicService(buildConfig());

    try {
      await service.warmup(claims, {
        stageId: 'stage-1',
        topic: 'Gravity',
      });
      throw new Error('Expected the upstream request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpException = error as HttpException;
      expect(httpException.getStatus()).toBe(404);
      expect(httpException.getResponse()).toEqual(
        expect.objectContaining({
          code: 'OPENMAIC_UPSTREAM_ERROR',
          message: 'Classroom unavailable',
          details: { stageId: 'stage-1' },
        }),
      );
    }
  });

  it.each(['', '<your-supabase-service-role-key>'])(
    'warns and skips metadata persistence when SUPABASE_SERVICE_ROLE_KEY is %s',
    async (supabaseServiceRoleKey) => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
        jsonResponse({
          status: 'ready',
          stageId: 'stage-1',
          classroomId: 'classroom-1',
        }),
      );

      const service = new OpenMaicService(
        buildConfig({
          supabaseServiceRoleKey,
        }),
      );

      await service.warmup(claims, {
        stageId: 'stage-1',
        topic: 'Gravity',
      });

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY'),
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );
});
