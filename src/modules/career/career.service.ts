import { Inject, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';

export interface CareerProxyResult {
  statusCode: number;
  body: unknown;
}

@Injectable()
export class CareerService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async forward(
    request: FastifyRequest & { user: GatewayClaims },
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | undefined>,
  ): Promise<CareerProxyResult> {
    const url = new URL(path, this.config.services.careerServiceUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers: this.buildHeaders(request),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.services.proxyTimeoutMs),
      });

      const text = await response.text();
      const parsed = text ? safeJsonParse(text) : {};

      return {
        statusCode: response.status,
        body: response.status >= 500 ? sanitizeServerError(parsed, response.status) : parsed,
      };
    } catch (error) {
      const isTimeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

      return {
        statusCode: isTimeout ? 504 : 502,
        body: {
          code: isTimeout ? 'CAREER_SERVICE_TIMEOUT' : 'CAREER_SERVICE_UNAVAILABLE',
          message: isTimeout ? 'Career service request timed out' : 'Career service is unavailable',
          request_id: request.id,
        },
      };
    }
  }

  private buildHeaders(request: FastifyRequest & { user: GatewayClaims }): Record<string, string> {
    const incomingHeaders = request.headers as Record<string, string | undefined>;
    const claims = request.user;

    const headers: Record<string, string> = {
      'x-user-id': claims.userId,
      'x-user-email': claims.email ?? '',
      'x-user-role': claims.roles[0] ?? 'student',
      'x-user-roles': claims.roles.join(','),
      'x-request-id': request.id,
      'x-internal-key': this.config.services.internalServiceKey,
      'content-type': incomingHeaders['content-type'] ?? 'application/json',
    };

    if (claims.tenantId) {
      headers['x-tenant-id'] = claims.tenantId;
    }
    if (claims.orgId) {
      headers['x-org-id'] = claims.orgId;
    }
    if (incomingHeaders.authorization) {
      headers.authorization = incomingHeaders.authorization;
    }

    return headers;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {
      code: 'CAREER_SERVICE_INVALID_RESPONSE',
      message: 'Career service returned an invalid response',
    };
  }
}

function sanitizeServerError(body: unknown, statusCode: number): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const candidate = body as Record<string, unknown>;
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'CAREER_SERVICE_ERROR',
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : statusCode === 504
            ? 'Career service request timed out'
            : 'Career service failed to process the request',
    };
  }

  return {
    code: 'CAREER_SERVICE_ERROR',
    message: 'Career service failed to process the request',
  };
}
