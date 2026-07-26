import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import replyFrom from '@fastify/reply-from';
import { randomUUID } from 'crypto';
import { IncomingMessage } from 'http';
import { AppModule } from './app.module';
import { loadConfiguration } from './config/configuration';
import { installOpenMaicHmrProxy } from './modules/openmaic/hmr-proxy';

function getRoutePrefix(pathname: string): string {
  if (pathname.startsWith('/auth')) {
    return 'auth';
  }
  if (pathname.startsWith('/ai')) {
    return 'ai';
  }
  if (pathname.startsWith('/rest')) {
    return 'rest';
  }
  if (pathname.startsWith('/storage')) {
    return 'storage';
  }
  if (pathname.startsWith('/health')) {
    return 'health';
  }
  if (pathname.startsWith('/career')) {
    return 'career';
  }
  if (pathname.startsWith('/api')) {
    return 'api';
  }
  if (pathname.startsWith('/openmaic')) {
    return 'openmaic';
  }

  return 'other';
}

function safeRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}

async function bootstrap(): Promise<void> {
  const config = loadConfiguration(process.env);

  const adapter = new FastifyAdapter({
    logger: {
      level: config.logLevel,
    },
    trustProxy: true,
    bodyLimit: config.bodyLimitMb * 1024 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: (request: IncomingMessage) => safeRequestId(request.headers['x-request-id']),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: false,
    }),
  );

  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'https://cdn.jsdelivr.net'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        'img-src': ["'self'", 'data:', 'blob:', ...config.security.allowedOrigins],
        'font-src': [
          "'self'",
          'data:',
          'blob:',
          'https://frontend-cdn.perplexity.ai',
          ...config.security.allowedOrigins,
        ],
        'connect-src': [
          "'self'",
          'https://huggingface.co',
          'https://*.huggingface.co',
          'https://hf.co',
          'https://*.hf.co',
          'https://xethub.hf.co',
          'https://*.xethub.hf.co',
          'https://cdn-lfs.huggingface.co',
          'https://cdn.jsdelivr.net',
          ...config.security.allowedOrigins,
        ],
        'media-src': ["'self'", 'blob:', 'data:'],
        'worker-src': ["'self'", 'blob:'],
        'frame-ancestors': ["'self'", ...config.security.allowedOrigins],
      },
    },
  });

  await fastify.register(cors, {
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'apikey', 'x-client-info', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    strictPreflight: true,
    optionsSuccessStatus: 204,
    maxAge: 600,
  });

  await fastify.register(replyFrom, {
    http: {
      requestOptions: {
        timeout: config.services.proxyTimeoutMs,
      },
    },
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const upstreamHostHeader = request.headers['x-upstream-host'];
    request.log.info(
      {
        requestId: request.id,
        routePrefix: getRoutePrefix(request.raw.url || request.url),
        upstreamHost: typeof upstreamHostHeader === 'string' ? upstreamHostHeader : undefined,
        latencyMs: reply.elapsedTime,
        statusCode: reply.statusCode,
      },
      'request_complete',
    );
    done();
  });

  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`Lumina API Gateway listening on port ${config.port}`);

  if (config.nodeEnv === 'development') {
    const httpServer = app.getHttpAdapter().getInstance().server;
    installOpenMaicHmrProxy(httpServer, config.services.openmaicServiceUrl);
    logger.log('OpenMAIC HMR WebSocket proxy installed (development mode)');
  }
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? error.message : 'Failed to bootstrap application');
  process.exit(1);
});
