import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import replyFrom from '@fastify/reply-from';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

function buildValidEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    LOG_LEVEL: 'silent',
    BODY_LIMIT_MB: '2',
    CORS_ORIGINS: '*',
    SUPABASE_JWKS_URI: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    SUPABASE_JWT_ISSUER: 'https://example.supabase.co/auth/v1',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    REDIS_URL: 'redis://127.0.0.1:6390',
    AUTH_SERVICE_URL: 'http://127.0.0.1:3001',
    TENANT_SERVICE_URL: 'http://127.0.0.1:3003',
    USER_SERVICE_URL: 'http://127.0.0.1:3004',
    COURSE_SERVICE_URL: 'http://127.0.0.1:3005',
    ENROLLMENT_SERVICE_URL: 'http://127.0.0.1:3006',
    ASSIGNMENT_SERVICE_URL: 'http://127.0.0.1:3007',
    SKILL_SERVICE_URL: 'http://127.0.0.1:3008',
    AI_SERVICE_URL: 'http://127.0.0.1:3002',
    GAMIFICATION_SERVICE_URL: 'http://127.0.0.1:3009',
    ANALYTICS_SERVICE_URL: 'http://127.0.0.1:3010',
    NOTIFICATION_SERVICE_URL: 'http://127.0.0.1:3011',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    OPENMAIC_SERVICE_URL: 'https://openmaic.example',
    PERSONALIZATION_SERVICE_URL: 'http://127.0.0.1:3012',
    PROXY_TIMEOUT_MS: '100',
    RATE_LIMIT_GLOBAL_TTL: '60000',
    RATE_LIMIT_GLOBAL_LIMIT: '1000',
    RATE_LIMIT_AUTH_TTL: '60000',
    RATE_LIMIT_AUTH_LIMIT: '1000',
    RATE_LIMIT_AI_TTL: '60000',
    RATE_LIMIT_AI_LIMIT: '1000',
    RATE_LIMIT_REST_TTL: '60000',
    RATE_LIMIT_REST_LIMIT: '1000',
    RATE_LIMIT_STORAGE_TTL: '60000',
    RATE_LIMIT_STORAGE_LIMIT: '1000',
    RATE_LIMIT_OPENMAIC_TTL: '60000',
    RATE_LIMIT_OPENMAIC_LIMIT: '1000',
    PUBLIC_ROUTES: '/auth/login,/auth/refresh',
    ...overrides,
  };
}

describe('Auth context guard e2e', () => {
  let app: NestFastifyApplication;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };
    process.env = {
      ...process.env,
      ...buildValidEnv(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        logger: false,
        trustProxy: true,
      }),
    );

    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(helmet);
    await fastify.register(cors, { origin: true, credentials: true });
    await fastify.register(replyFrom, {
      http: {
        requestOptions: {
          timeout: Number(process.env.PROXY_TIMEOUT_MS ?? '100'),
        },
      },
    });

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    process.env = originalEnv;
  });

  it('returns 401 instead of 500 when /auth/context is requested without a bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/auth/context');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(typeof response.body.requestId).toBe('string');
    expect(response.body.message).toMatch(/bearer|token|unauthorized/i);
  });
});
