import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import replyFrom from '@fastify/reply-from';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/config.constants';
import { AppConfig } from '../src/config/config.types';
import { isPublicRoute } from '../src/config/configuration';
import { GatewayClaims } from '../src/modules/auth/auth.types';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard';
import { PUBLIC_ROUTE_KEY } from '../src/modules/auth/public.decorator';

type AuthenticatedRequest = IncomingMessage & {
  user?: GatewayClaims;
  headers: IncomingMessage['headers'] & {
    authorization?: string;
  };
  raw?: {
    url?: string;
  };
  url?: string;
};

@Injectable()
class MockJwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isMarkedPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = request.raw?.url || request.url || '/';

    if (isMarkedPublic || isPublicRoute(path, this.config.publicRoutes)) {
      return true;
    }

    if (request.headers.authorization !== 'Bearer valid-token') {
      throw new UnauthorizedException('Missing or invalid bearer token');
    }

    request.user = {
      userId: 'user-123',
      orgId: 'org-456',
      roles: ['admin'],
      email: 'user@example.com',
      raw: { sub: 'user-123' },
    };

    return true;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

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
    INTERNAL_SERVICE_KEY: 'test-internal-key',
    PUBLIC_ROUTES: '/auth/login,/auth/refresh',
    ...overrides,
  };
}

describe('OpenMAIC gateway e2e', () => {
  let app: NestFastifyApplication;
  let openmaicServer: Server;
  let supabaseServer: Server;
  let originalEnv: NodeJS.ProcessEnv;
  let lastSupabaseBody = '';

  beforeAll(async () => {
    originalEnv = { ...process.env };

    const openmaic = await startServer(async (req, res) => {
      const body = await readBody(req);
      res.setHeader('content-type', 'application/json');

      if (req.method === 'POST' && req.url === '/api/warmup') {
        res.end(
          JSON.stringify({
            success: true,
            status: 'ready',
            stageId: 'stage-1',
            classroomId: 'classroom-1',
            embedUrl: 'https://openmaic.example/classroom/classroom-1?embed=true&mode=pathwisse-lesson',
            message: 'warm',
          }),
        );
        return;
      }

      if (req.method === 'GET' && req.url === '/api/stages/stage-1') {
        res.end(
          JSON.stringify({
            success: true,
            status: 'warming',
            stageId: 'stage-1',
            jobId: 'job-1',
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/stages/stage-1/regenerate') {
        res.end(
          JSON.stringify({
            success: true,
            status: 'warming',
            stageId: 'stage-1',
            jobId: 'job-2',
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ success: false }));
    });

    const supabase = await startServer(async (req, res) => {
      lastSupabaseBody = await readBody(req);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ id: 'meta-1' }]));
    });

    openmaicServer = openmaic.server;
    supabaseServer = supabase.server;

    process.env = {
      ...process.env,
      ...buildValidEnv({
        OPENMAIC_SERVICE_URL: openmaic.baseUrl,
        SUPABASE_URL: supabase.baseUrl,
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

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

  it('warms a shared classroom through the OpenMAIC upstream and writes metadata to Supabase', async () => {
    const response = await request(app.getHttpServer())
      .post('/openmaic/warmup')
      .set('authorization', 'Bearer valid-token')
      .send({
        stageId: 'stage-1',
        topic: 'Gravity',
        description: 'Foundations of gravity',
        language: 'en-US',
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.classroomId).toBe('classroom-1');

    // Give some time for background persistence
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(JSON.parse(lastSupabaseBody)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage_id: 'stage-1',
          classroom_id: 'classroom-1',
          status: 'ready',
          user_id: 'user-123',
        }),
      ]),
    );
  });

  it('returns the upstream shared classroom status for a stage', async () => {
    const response = await request(app.getHttpServer())
      .get('/openmaic/stages/stage-1')
      .set('authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'warming',
      stageId: 'stage-1',
      jobId: 'job-1',
    });
  });

  it('queues regeneration through the upstream service', async () => {
    const response = await request(app.getHttpServer())
      .post('/openmaic/stages/stage-1/regenerate')
      .set('authorization', 'Bearer valid-token')
      .send({
        topic: 'Gravity',
        description: 'Updated classroom',
        language: 'en-US',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'warming',
      stageId: 'stage-1',
      jobId: 'job-2',
    });
  });
});
