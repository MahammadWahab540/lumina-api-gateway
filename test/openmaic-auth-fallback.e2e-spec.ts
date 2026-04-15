import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import replyFrom from '@fastify/reply-from';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500;
      res.end('mock-server-error');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

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
    PERSONALIZATION_SERVICE_URL: 'http://127.0.0.1:3012',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    OPENMAIC_SERVICE_URL: 'http://127.0.0.1:3013',
    PROXY_TIMEOUT_MS: '1000',
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

describe('OpenMAIC auth fallback e2e', () => {
  let app: NestFastifyApplication;
  let openmaicServer: Server;
  let supabaseServer: Server;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    const openmaic = await startServer((req, res) => {
      res.setHeader('content-type', 'application/json');

      if (req.method === 'GET' && req.url === '/api/pathwisse/classrooms/stages/stage-1') {
        res.end(
          JSON.stringify({
            success: true,
            status: 'ready',
            stageId: 'stage-1',
            classroomId: 'classroom-1',
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ success: false }));
    });

    const supabase = await startServer((req, res) => {
      res.setHeader('content-type', 'application/json');

      if (req.url === '/auth/v1/.well-known/jwks.json') {
        res.end(JSON.stringify({ keys: [] }));
        return;
      }

      if (req.url === '/auth/v1/user' && req.headers.authorization === 'Bearer fallback-token') {
        res.end(
          JSON.stringify({
            id: 'user-123',
            email: 'user@example.com',
            role: 'authenticated',
            app_metadata: {
              roles: ['student'],
              org_id: 'org-456',
            },
          }),
        );
        return;
      }

      res.statusCode = 401;
      res.end(JSON.stringify({ message: 'Unauthorized' }));
    });

    openmaicServer = openmaic.server;
    supabaseServer = supabase.server;

    process.env = {
      ...process.env,
      ...buildValidEnv({
        OPENMAIC_SERVICE_URL: openmaic.baseUrl,
        SUPABASE_URL: supabase.baseUrl,
        SUPABASE_JWKS_URI: `${supabase.baseUrl}/auth/v1/.well-known/jwks.json`,
        SUPABASE_JWT_ISSUER: `${supabase.baseUrl}/auth/v1`,
      }),
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

    await new Promise<void>((resolve, reject) => {
      openmaicServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      supabaseServer.close((err) => (err ? reject(err) : resolve()));
    });

    process.env = originalEnv;
  });

  it('accepts bearer tokens through Supabase user introspection when JWKS validation cannot verify them', async () => {
    const response = await request(app.getHttpServer())
      .get('/openmaic/classrooms/stages/stage-1')
      .set('authorization', 'Bearer fallback-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ready',
      stageId: 'stage-1',
      classroomId: 'classroom-1',
    });
  });
});
