import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';
import { VoiceDiscoveryService } from './voice-discovery.service';

function buildConfig(overrides: Partial<AppConfig['services']> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    logLevel: 'silent',
    bodyLimitMb: 2,
    corsOrigins: ['*'],
    publicRoutes: [],
    auth: {
      jwksUri: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
      issuer: 'https://example.supabase.co/auth/v1',
      audience: 'authenticated',
    },
    security: { allowedOrigins: ['*'] },
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
      internalServiceKey: 'internal-secret',
      luminaGatewayUrl: 'http://127.0.0.1:3000',
      voiceDiscoveryServiceUrl: 'http://127.0.0.1:8002',
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
      voice: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const claims: GatewayClaims = {
  userId: 'user-123',
  orgId: 'org-456',
  roles: ['student'],
  email: 'student@example.com',
  raw: { sub: 'user-123' },
};

describe('VoiceDiscoveryService', () => {
  beforeEach(() => jest.restoreAllMocks());

  it('creates the assignment voice session row before calling AgentScope when no voiceSessionId is supplied', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/rest/v1/voice_sessions') && init?.method === 'POST') {
        return jsonResponse([{ id: 'voice-session-1' }]);
      }
      if (url.includes('/rest/v1/assignments')) {
        return jsonResponse([{ title: 'Algorithms', description: 'Explain your solution.' }]);
      }
      if (url.includes('/rest/v1/assignment_submissions')) {
        return jsonResponse([{ submission_text: 'My solution text' }]);
      }
      if (url === 'http://127.0.0.1:8002/sessions') {
        return jsonResponse({
          session_id: 'voice-session-1',
          agentscope_session_id: 'agent-session-1',
          ws_endpoint: 'ws://localhost:8002/ws/user-123/voice-session-1',
          context_items_loaded: 2,
        }, 201);
      }
      if (url.includes('/rest/v1/voice_sessions') && init?.method === 'PATCH') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const service = new VoiceDiscoveryService(buildConfig());
    const result = await service.createAssignmentSession(claims, 'Bearer jwt', {
      assignmentId: 'assignment-1',
      modelProvider: 'gemini',
    });

    expect(result.sessionId).toBe('voice-session-1');
    expect(result.wsEndpoint).toBe('ws://localhost:8002/ws/user-123/voice-session-1');
    const firstVoiceSessionCall = fetchSpy.mock.calls.find(([input, init]) =>
      String(input).includes('/rest/v1/voice_sessions') && init?.method === 'POST',
    );
    expect(firstVoiceSessionCall).toBeDefined();
  });

  it.each(['', 'your-service-role-key', '<your-supabase-service-role-key>'])(
    'fails fast when service role key is not configured: %s',
    async (supabaseServiceRoleKey) => {
      const service = new VoiceDiscoveryService(buildConfig({ supabaseServiceRoleKey }));

      await expect(service.createAssignmentSession(claims, 'Bearer jwt', {
        assignmentId: 'assignment-1',
      })).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

  it('passes through agent health details', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      jsonResponse({
        status: 'ok',
        providers: { gemini: true, openai: false, dashscope: false },
        pool: { warm: 2, active: 0, target: 2 },
      }),
    );

    const service = new VoiceDiscoveryService(buildConfig());
    await expect(service.healthCheck()).resolves.toEqual({
      healthy: true,
      status: 'ok',
      providers: { gemini: true, openai: false, dashscope: false },
      pool: { warm: 2, active: 0, target: 2 },
    });
  });
});
