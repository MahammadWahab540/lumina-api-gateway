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
  if (pathname.startsWith('/api')) {
    return 'api';
  }
  if (pathname.startsWith('/openmaic')) {
    return 'openmaic';
  }

  return 'other';
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
    genReqId: (request: IncomingMessage) => {
      const incoming = request.headers['x-request-id'];
      if (typeof incoming === 'string' && incoming.trim().length > 0) {
        return incoming;
      }
      return randomUUID();
    },
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
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", "data:", "blob:", ...config.security.allowedOrigins],
        'font-src': ["'self'", "data:", "blob:", ...config.security.allowedOrigins],
        'frame-ancestors': ["'self'", ...config.security.allowedOrigins],
      },
    },
  });
  await fastify.register(cors, {
    origin: config.security.allowedOrigins.includes('*') ? true : config.security.allowedOrigins,
    credentials: true,
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
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? error.message : 'Failed to bootstrap application');
  process.exit(1);
});
