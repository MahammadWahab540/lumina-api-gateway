import { Inject, Injectable, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';

import { GatewayClaims } from '../auth/auth.types';

type ServicePrefix =
  | 'auth'
  | 'tenant'
  | 'user'
  | 'course'
  | 'enrollment'
  | 'assignment'
  | 'skill'
  | 'ai'
  | 'gamification'
  | 'analytics'
  | 'notification'
  | 'rest'
  | 'storage'
  | 'personalization';

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

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) { }

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
        this.rewriteRequestHeaders(headers, request, prefix),
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
    const services = this.config.services;
    switch (prefix) {
      case 'auth': return services.authServiceUrl;
      case 'tenant': return services.tenantServiceUrl;
      case 'user': return services.userServiceUrl;
      case 'course': return services.courseServiceUrl;
      case 'enrollment': return services.enrollmentServiceUrl;
      case 'assignment': return services.assignmentServiceUrl;
      case 'skill': return services.skillServiceUrl;
      case 'ai': return services.aiServiceUrl;
      case 'gamification': return services.gamificationServiceUrl;
      case 'analytics': return services.analyticsServiceUrl;
      case 'notification': return services.notificationServiceUrl;
      case 'rest': return `${services.supabaseUrl}/rest/v1`;
      case 'storage': return `${services.supabaseUrl}/storage/v1`;
      case 'personalization': return services.personalizationServiceUrl;
      default: return services.authServiceUrl; // Should be unreachable with proper types
    }
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

    // Ensure no double slashes when joining paths
    const joinedPath = `${basePath}${normalizedSuffix}`.replace(/\/+/g, '/');
    upstream.pathname = joinedPath || '/';
    upstream.search = queryString ? `?${queryString}` : '';

    return upstream.toString();
  }

  private rewriteRequestHeaders(
    headers: Record<string, unknown>,
    request: FastifyRequest,
    prefix: ServicePrefix,
  ): Record<string, unknown> {
    const rewritten: Record<string, unknown> = {};

    for (const [header, value] of Object.entries(headers)) {
      const lowerHeader = header.toLowerCase();
      // Drop hop-by-hop headers, Host, and specifically external security headers to avoid spoofing
      if (
        HOP_BY_HOP_HEADERS.has(lowerHeader) ||
        lowerHeader === 'host' ||
        lowerHeader === 'x-user-id' ||
        lowerHeader === 'x-org-id' ||
        lowerHeader === 'x-user-roles' ||
        lowerHeader === 'x-user-email'
      ) {
        continue;
      }
      rewritten[header] = value;
    }

    rewritten['x-request-id'] = request.id;

    if (prefix === 'rest' || prefix === 'storage') {
      rewritten['apikey'] = this.config.services.supabaseAnonKey;
    }

    // Inject authenticated claims if present
    const claims = (request as unknown as { user?: GatewayClaims }).user;
    if (claims) {
      rewritten['x-user-id'] = claims.userId;
      if (claims.orgId) {
        rewritten['x-org-id'] = claims.orgId;
      }
      if (claims.roles && claims.roles.length > 0) {
        rewritten['x-user-roles'] = claims.roles.join(',');
      }
      if (claims.email) {
        rewritten['x-user-email'] = claims.email;
      }
    }

    return rewritten;
  }
}
