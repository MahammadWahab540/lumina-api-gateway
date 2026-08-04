import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
      careerServiceUrl: 'http://127.0.0.1:3013',
      internalServiceKey: 'internal-secret',
      luminaGatewayUrl: 'http://127.0.0.1:3000',
      voiceDiscoveryServiceUrl: 'http://127.0.0.1:8002',
      voiceAgentInternalSecret: overrides.voiceAgentInternalSecret || 'voice-agent-secret',
      personalizationServiceUrl: 'http://127.0.0.1:3012',
      proxyTimeoutMs: 1000,
      openmaicEmbedSigningSecret: 'secret',
      openmaicEmbedTtlSeconds: 900,
      ...overrides,
    },
    rateLimit: {
      global: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      auth: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      ai: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
      career: { ttlMs: 60000, limit: 1000, blockDurationMs: 60000 },
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
      'https://openmaic.example/base/api/warmup-classroom',
    );

    const options = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-forwarded-host']).toBe('classroom.lumina.test');
    expect(headers['x-forwarded-proto']).toBe('https');
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
          message: 'Classroom unavailable (Upstream: https://openmaic.example/api/warmup-classroom)',
          upstreamUrl: 'https://openmaic.example/api/warmup-classroom',
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

function rawResponse(
  body: BodyInit | null,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

/** Mirrors OpenMAIC's `audioServingUrl()` encoding of the `:audioId` route param. */
function encodeAudioId(relativePath: string): string {
  return Buffer.from(relativePath, 'utf8').toString('base64url');
}

describe('OpenMaicService.streamAudio', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('streams a valid audio response through, preserving status, content-type, content-length and accept-ranges', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      rawResponse(bytes, 200, {
        'content-type': 'audio/wav',
        'content-length': '4',
      }),
    );

    const service = new OpenMaicService(buildConfig());
    const result = await service.streamAudio(
      encodeAudioId('api/classroom-media/room-1/audio/clip.wav'),
      {},
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://openmaic.example/api/classroom-media/room-1/audio/clip.wav',
    );
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('audio/wav');
    expect(result.headers['content-length']).toBe('4');
    expect(result.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.from(result.body)).toEqual(Buffer.from(bytes));
  });

  it('forwards the Range/If-Range headers and preserves a 206 partial-content response', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      rawResponse(new Uint8Array([9, 9]), 206, {
        'content-type': 'audio/wav',
        'content-range': 'bytes 0-1/4',
        'accept-ranges': 'bytes',
        'content-length': '2',
      }),
    );

    const service = new OpenMaicService(buildConfig());
    const result = await service.streamAudio(encodeAudioId('audio/clip.wav'), {
      range: 'bytes=0-1',
      'if-range': 'W/"etag"',
    });

    const forwardedHeaders = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = forwardedHeaders.headers as Record<string, string>;
    expect(headers['range']).toBe('bytes=0-1');
    expect(headers['if-range']).toBe('W/"etag"');

    expect(result.status).toBe(206);
    expect(result.headers['content-range']).toBe('bytes 0-1/4');
    expect(result.headers['accept-ranges']).toBe('bytes');
    expect(result.headers['content-length']).toBe('2');
  });

  it('surfaces an upstream 404 as NotFoundException instead of a generic error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => rawResponse('not found', 404, { 'content-type': 'text/plain' }));

    const service = new OpenMaicService(buildConfig());

    try {
      await service.streamAudio(encodeAudioId('audio/missing.wav'), {});
      throw new Error('Expected streamAudio to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
      expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'AUDIO_NOT_FOUND' });
    }
  });

  it('rejects an HTML error body instead of serving it back as audio', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      rawResponse('<html><body>Internal Server Error</body></html>', 500, {
        'content-type': 'text/html; charset=utf-8',
      }),
    );

    const service = new OpenMaicService(buildConfig());

    try {
      await service.streamAudio(encodeAudioId('audio/broken.wav'), {});
      throw new Error('Expected streamAudio to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).getStatus()).toBe(502);
      expect((error as BadGatewayException).getResponse()).toMatchObject({
        code: 'AUDIO_UPSTREAM_INVALID_RESPONSE',
      });
    }
  });

  it('rejects a JSON error body instead of serving it back as audio', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      rawResponse(JSON.stringify({ error: 'boom' }), 500, {
        'content-type': 'application/json',
      }),
    );

    const service = new OpenMaicService(buildConfig());

    try {
      await service.streamAudio(encodeAudioId('audio/broken.wav'), {});
      throw new Error('Expected streamAudio to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).getStatus()).toBe(502);
      expect((error as BadGatewayException).getResponse()).toMatchObject({
        code: 'AUDIO_UPSTREAM_INVALID_RESPONSE',
      });
    }
  });

  it('rejects a 200 response whose content-type is not audio/*, even though the status is ok', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      rawResponse(JSON.stringify({ ok: true }), 200, { 'content-type': 'application/json' }),
    );

    const service = new OpenMaicService(buildConfig());

    try {
      await service.streamAudio(encodeAudioId('audio/mislabeled.wav'), {});
      throw new Error('Expected streamAudio to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as BadGatewayException).getResponse()).toMatchObject({
        code: 'AUDIO_UPSTREAM_INVALID_RESPONSE',
      });
    }
  });

  it.each([
    ['contains a literal slash', 'api/classroom-media/room-1/audio/clip.wav'],
    ['percent-encoded, not base64url', encodeURIComponent('api/classroom-media/room-1/audio/clip.wav')],
    ['empty id', ''],
  ])('rejects an audio id that is not valid base64url (%s), without contacting the upstream', async (_label, rawId) => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new OpenMaicService(buildConfig());

    try {
      await service.streamAudio(rawId, {});
      throw new Error('Expected streamAudio to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'INVALID_AUDIO_ID' });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['path traversal', '../../etc/passwd'],
    ['absolute URL scheme', 'https://evil.example/audio.wav'],
    ['leading slash (protocol-relative)', '//evil.example/audio.wav'],
    ['disallowed character', 'audio/clip.wav?x=<script>'],
  ])(
    'rejects a well-formed base64url id whose decoded path is unsafe (%s), without contacting the upstream',
    async (_label, unsafePath) => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const service = new OpenMaicService(buildConfig());

      try {
        await service.streamAudio(encodeAudioId(unsafePath), {});
        throw new Error('Expected streamAudio to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getStatus()).toBe(400);
        expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'INVALID_AUDIO_ID' });
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('base64url-decodes the audio id before joining it onto the upstream base URL', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => rawResponse(new Uint8Array([1]), 200, { 'content-type': 'audio/mpeg' }));

    const service = new OpenMaicService(buildConfig());
    await service.streamAudio(encodeAudioId('api/classroom-media/room-1/audio/clip.mp3'), {});

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://openmaic.example/api/classroom-media/room-1/audio/clip.mp3',
    );
  });
});
