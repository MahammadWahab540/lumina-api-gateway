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
import { isPublicRoute, loadConfiguration } from '../src/config/configuration';
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
    AI_SERVICE_URL: 'http://127.0.0.1:3002',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    PROXY_TIMEOUT_MS: '100',
    RATE_LIMIT_GLOBAL_TTL: '60000',
    RATE_LIMIT_GLOBAL_LIMIT: '1000',
    RATE_LIMIT_AUTH_TTL: '60000',
    RATE_LIMIT_AUTH_LIMIT: '1000',
    RATE_LIMIT_AI_TTL: '60000',
    RATE_LIMIT_AI_LIMIT: '1000',
    PUBLIC_ROUTES: '/auth/login,/auth/refresh',
    ...overrides,
  };
}

describe('Gateway e2e', () => {
  let app: NestFastifyApplication;
  let authServer: Server;
  let aiServer: Server;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    const auth = await startServer(async (req, res) => {
      const body = await readBody(req);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          service: 'auth',
          path: req.url,
          method: req.method,
          headers: req.headers,
          body,
        }),
      );
    });

    const ai = await startServer(async (req, res) => {
      if (req.url?.startsWith('/slow')) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      const body = await readBody(req);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          service: 'ai',
          path: req.url,
          method: req.method,
          headers: req.headers,
          body,
        }),
      );
    });

    authServer = auth.server;
    aiServer = ai.server;

    process.env = {
      ...process.env,
      ...buildValidEnv({
        AUTH_SERVICE_URL: auth.baseUrl,
        AI_SERVICE_URL: ai.baseUrl,
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
      authServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      aiServer.close((err) => (err ? reject(err) : resolve()));
    });

    process.env = originalEnv;
  });

  it('returns health status without auth', async () => {
    const response = await request(app.getHttpServer()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.checks.process).toBe('up');
    expect(['ok', 'degraded']).toContain(response.body.status);
  });

  it('rejects protected ai route without token', async () => {
    const response = await request(app.getHttpServer()).get('/ai/infer');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(typeof response.body.requestId).toBe('string');
  });

  it('scrubs spoofed headers and injects trusted claims on auth proxy route', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/session?include=roles')
      .set('authorization', 'Bearer valid-token')
      .set('x-user-id', 'spoofed-user')
      .set('x-org-id', 'spoofed-org')
      .send({ source: 'e2e' });

    expect(response.status).toBe(200);
    expect(response.body.service).toBe('auth');
    expect(response.body.path).toBe('/session?include=roles');
    expect(response.body.headers['x-user-id']).toBe('user-123');
    expect(response.body.headers['x-org-id']).toBe('org-456');
    expect(response.body.headers['x-user-roles']).toBe('admin');
    expect(response.body.headers['x-user-email']).toBe('user@example.com');
    expect(response.body.headers['x-request-id']).toBeDefined();
  });

  it('forwards authenticated ai proxy traffic to ai upstream', async () => {
    const response = await request(app.getHttpServer())
      .get('/ai/infer?model=lite')
      .set('authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body.service).toBe('ai');
    expect(response.body.path).toBe('/infer?model=lite');
    expect(response.body.headers['x-user-id']).toBe('user-123');
  });

  it('returns standardized timeout envelope for slow upstream', async () => {
    const response = await request(app.getHttpServer())
      .get('/ai/slow')
      .set('authorization', 'Bearer valid-token');

    expect(response.status).toBe(504);
    expect(response.body.code).toBe('UPSTREAM_TIMEOUT');
    expect(typeof response.body.requestId).toBe('string');
  });

  it('fails fast on invalid environment values', () => {
    expect(() =>
      loadConfiguration(
        buildValidEnv({
          SUPABASE_JWKS_URI: 'not-a-url',
        }),
      ),
    ).toThrow('Invalid environment configuration');
  });

  it('parses PUBLIC_ROUTES and supports wildcard matching', () => {
    const config = loadConfiguration(
      buildValidEnv({
        PUBLIC_ROUTES: '/auth/login, /hooks/*',
      }),
    );

    expect(config.publicRoutes).toEqual(['/auth/login', '/hooks/*']);
    expect(isPublicRoute('/hooks/stripe', config.publicRoutes)).toBe(true);
  });
});
