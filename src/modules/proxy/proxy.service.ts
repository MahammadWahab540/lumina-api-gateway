import { Inject, Injectable, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';

type ServicePrefix = 'auth' | 'ai';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
]);

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  forward(request: FastifyRequest, reply: FastifyReply, prefix: ServicePrefix): void {
    const targetBase = this.getTargetBase(prefix);
    const targetUrl = this.buildTargetUrl(targetBase, request, prefix);
    const upstreamHost = new URL(targetBase).host;
    request.headers['x-upstream-host'] = upstreamHost;

    this.logger.log(
      JSON.stringify({
        msg: 'proxy_forward',
        requestId: request.id,
        routePrefix: prefix,
        upstreamHost,
        targetUrl,
      }),
    );

    const from = (reply as unknown as {
      from: (url: string, options: Record<string, unknown>) => void;
    }).from;

    from.call(reply, targetUrl, {
      rewriteRequestHeaders: (_req: FastifyRequest, headers: Record<string, unknown>) =>
        this.rewriteRequestHeaders(headers, request),
      onError: (res: FastifyReply, payload: { error: Error }) => {
        const error = payload.error;
        const isTimeout = /timeout|timed out/i.test(error.message);
        const statusCode = isTimeout ? 504 : 502;
        const code = isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
        const message = isTimeout ? 'Upstream service timed out' : 'Unable to reach upstream service';

        if (!res.sent) {
          res.code(statusCode).send({
            code,
            message,
            requestId: request.id,
            details: { name: error.name, message: error.message },
          });
        }
      },
    });
  }

  private getTargetBase(prefix: ServicePrefix): string {
    if (prefix === 'auth') {
      return this.config.services.authServiceUrl;
    }

    return this.config.services.aiServiceUrl;
  }

  private buildTargetUrl(targetBase: string, request: FastifyRequest, prefix: ServicePrefix): string {
    const rawUrl = request.raw.url || request.url;
    const [pathPart, queryString] = rawUrl.split('?');

    let suffixPath = pathPart.startsWith(`/${prefix}`) ? pathPart.slice(prefix.length + 1) : pathPart;
    if (suffixPath.length === 0) {
      suffixPath = '/';
    }
    if (!suffixPath.startsWith('/')) {
      suffixPath = `/${suffixPath}`;
    }

    const upstream = new URL(targetBase);
    const basePath = upstream.pathname.endsWith('/')
      ? upstream.pathname.slice(0, -1)
      : upstream.pathname;
    const normalizedSuffix = suffixPath === '/' ? '' : suffixPath;
    upstream.pathname = `${basePath}${normalizedSuffix}` || '/';
    upstream.search = queryString ? `?${queryString}` : '';

    return upstream.toString();
  }

  private rewriteRequestHeaders(
    headers: Record<string, unknown>,
    request: FastifyRequest,
  ): Record<string, unknown> {
    const rewritten: Record<string, unknown> = {};

    for (const [header, value] of Object.entries(headers)) {
      if (HOP_BY_HOP_HEADERS.has(header.toLowerCase()) || header.toLowerCase() === 'host') {
        continue;
      }
      rewritten[header] = value;
    }

    rewritten['x-request-id'] = request.id;
    return rewritten;
  }
}
