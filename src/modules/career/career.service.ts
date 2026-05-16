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

    const headers = this.buildHeaders(request);
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : {};

    return {
      statusCode: response.status,
      body: parsed,
    };
  }

  private buildHeaders(request: FastifyRequest & { user: GatewayClaims }): Record<string, string> {
    const incomingHeaders = request.headers as Record<string, string | undefined>;
    const claims = request.user;

    const headers: Record<string, string> = {
      'x-user-id': claims.userId,
      'x-user-email': claims.email ?? '',
      'x-user-role': claims.roles[0] ?? 'student',
      'x-request-id': request.id,
      'x-internal-key': this.config.services.internalServiceKey,
    };

    if (incomingHeaders.authorization) {
      headers.authorization = incomingHeaders.authorization;
    }

    if (incomingHeaders['content-type']) {
      headers['content-type'] = incomingHeaders['content-type'];
    } else {
      headers['content-type'] = 'application/json';
    }

    return headers;
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

