import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';
import { WarmupClassroomRequest, WarmupClassroomResponse } from './openmaic.types';
import { FastifyRequest } from 'fastify';
import { IncomingHttpHeaders } from 'node:http';

type RequestContext = Pick<FastifyRequest, 'headers'>;
type UpstreamPayload = Record<string, unknown>;

function getHeaderValue(headers: IncomingHttpHeaders | undefined, headerName: string): string | undefined {
  const value = headers?.[headerName.toLowerCase()];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function isPlaceholderServiceRoleKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    /^<.+>$/.test(normalized) ||
    normalized.includes('placeholder') ||
    normalized.includes('your-supabase-service-role-key') ||
    normalized.includes('replace-me') ||
    normalized.includes('change-me')
  );
}

@Injectable()
export class OpenMaicService {
  private readonly logger = new Logger(OpenMaicService.name);
  private readonly supabaseServiceRoleKey: string | null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const key = this.config.services.supabaseServiceRoleKey;
    this.supabaseServiceRoleKey = isPlaceholderServiceRoleKey(key) ? null : key;

    if (!this.supabaseServiceRoleKey) {
      this.logger.warn(
        'SUPABASE_SERVICE_ROLE_KEY is missing or placeholder; skipping OpenMAIC metadata persistence',
      );
    }
  }

  async warmup(
    claims: GatewayClaims,
    request: WarmupClassroomRequest,
    requestContext?: RequestContext,
  ): Promise<WarmupClassroomResponse> {
    if (!request.stageId || !request.topic) {
      throw new BadRequestException('Missing required fields: stageId, topic');
    }

    const startedAt = Date.now();
    const response = await this.sendRequest<WarmupClassroomResponse>(
      '/api/pathwisse/classrooms/warmup',
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
      requestContext,
    );

    // Run persistence in background to avoid blocking
    this.persistMetadata(claims, request, response).catch((err) =>
      this.logger.warn(`Background metadata persistence failed: ${err.message}`),
    );

    this.logger.log(
      JSON.stringify({
        msg: 'openmaic_warmup',
        stageId: request.stageId,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }),
    );

    return response;
  }

  async getStage(stageId: string, requestContext?: RequestContext): Promise<WarmupClassroomResponse> {
    if (!stageId) {
      throw new BadRequestException('Missing required parameter: stageId');
    }

    const startedAt = Date.now();
    const response = await this.sendRequest<WarmupClassroomResponse>(
      `/api/pathwisse/classrooms/stages/${encodeURIComponent(stageId)}`,
      {
        method: 'GET',
      },
      requestContext,
    );

    this.logger.log(
      JSON.stringify({
        msg: 'openmaic_stage_lookup',
        stageId,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }),
    );

    return response;
  }

  async regenerate(
    claims: GatewayClaims,
    stageId: string,
    request: Omit<WarmupClassroomRequest, 'stageId'>,
    requestContext?: RequestContext,
  ): Promise<WarmupClassroomResponse> {
    if (!stageId || !request.topic) {
      throw new BadRequestException('Missing required fields: stageId, topic');
    }

    const startedAt = Date.now();
    const response = await this.sendRequest<WarmupClassroomResponse>(
      `/api/pathwisse/classrooms/stages/${encodeURIComponent(stageId)}/regenerate`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
      requestContext,
    );

    // Run persistence in background to avoid blocking
    this.persistMetadata(
      claims,
      {
        ...request,
        stageId,
      },
      response,
    ).catch((err) =>
      this.logger.warn(`Background metadata persistence failed: ${err.message}`),
    );

    this.logger.log(
      JSON.stringify({
        msg: 'openmaic_regenerate',
        stageId,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }),
    );

    return response;
  }

  private buildTargetUrl(pathname: string): string {
    const normalizedBase = this.config.services.openmaicServiceUrl.replace(/\/+$/, '');
    const normalizedPath = pathname.replace(/^\/+/, '');
    return new URL(normalizedPath, `${normalizedBase}/`).toString();
  }

  private buildRequestHeaders(initHeaders: HeadersInit | undefined, requestContext?: RequestContext): Headers {
    const headers = new Headers(initHeaders);
    headers.set('accept', 'application/json');
    headers.set('content-type', 'application/json');

    const forwardedHost = getHeaderValue(requestContext?.headers, 'x-forwarded-host');
    if (forwardedHost) {
      headers.set('x-forwarded-host', forwardedHost);
    }

    const forwardedProto = getHeaderValue(requestContext?.headers, 'x-forwarded-proto');
    if (forwardedProto) {
      headers.set('x-forwarded-proto', forwardedProto);
    }

    if (this.config.services.internalServiceKey) {
      headers.set('x-internal-secret', this.config.services.internalServiceKey);
    }

    return headers;
  }

  async proxyRequest(
    path: string,
    method: string,
    headers: Record<string, string>,
    body?: any,
  ): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
    const url = this.buildTargetUrl(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.services.proxyTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: this.buildRequestHeaders(headers),
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
      });

      const responseBody = await response.arrayBuffer();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        // Skip headers that might cause issues with proxying
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
          responseHeaders[key] = value;
        }
      });

      return {
        status: response.status,
        headers: responseHeaders,
        body: Buffer.from(responseBody),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseUpstreamPayload(rawBody: string): UpstreamPayload | null {
    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as UpstreamPayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  private getUpstreamErrorMessage(payload: UpstreamPayload | null, rawBody: string, status: number): string {
    if (payload) {
      const error = payload.error;
      if (typeof error === 'string' && error.trim().length > 0) {
        return error.trim();
      }

      const message = payload.message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim();
      }
    }

    const trimmed = rawBody.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    return `OpenMAIC request failed with status ${status}`;
  }

  private async sendRequest<T>(pathname: string, init: RequestInit, requestContext?: RequestContext): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.services.proxyTimeoutMs);

    try {
      const response = await fetch(this.buildTargetUrl(pathname), {
        ...init,
        headers: this.buildRequestHeaders(init.headers, requestContext),
        signal: controller.signal,
      });

      const rawBody = await response.text();
      const payload = this.parseUpstreamPayload(rawBody);

      if (!response.ok || (payload !== null && payload.success === false)) {
        const status = response.status >= 400 ? (response.status >= 500 ? 502 : response.status) : 502;
        throw new HttpException(
          {
            code: 'OPENMAIC_UPSTREAM_ERROR',
            message: this.getUpstreamErrorMessage(payload, rawBody, response.status),
            ...(payload?.details !== undefined ? { details: payload.details } : {}),
          },
          status,
        );
      }

      if (payload === null) {
        throw new BadGatewayException({
          code: 'OPENMAIC_INVALID_RESPONSE',
          message: 'OpenMAIC returned a non-JSON response',
        });
      }

      return payload as T;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof BadGatewayException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException('OpenMAIC upstream timed out');
      }

      throw new BadGatewayException(
        error instanceof Error ? error.message : 'OpenMAIC upstream request failed',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistMetadata(
    claims: GatewayClaims,
    request: WarmupClassroomRequest,
    response: WarmupClassroomResponse,
  ): Promise<void> {
    if (!this.supabaseServiceRoleKey) {
      return;
    }

    const payload = [
      {
        stage_id: request.stageId,
        classroom_id: response.classroomId ?? null,
        description: request.description ?? null,
        topic: request.topic,
        options: {
          ...(request.options ? { generation: request.options } : {}),
          ...(response.jobId ? { jobId: response.jobId } : {}),
        },
        agents: [],
        scenes: [],
        status: response.status,
        updated_at: new Date().toISOString(),
        user_id: claims.userId,
      },
    ];

    try {
      const metadataResponse = await fetch(
        `${this.config.services.supabaseUrl}/rest/v1/maic_classrooms?on_conflict=stage_id`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            apikey: this.supabaseServiceRoleKey,
            authorization: `Bearer ${this.supabaseServiceRoleKey}`,
            prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!metadataResponse.ok) {
        const details = await metadataResponse.text();
        this.logger.warn(`OpenMAIC metadata persistence failed: ${details}`);
      }
    } catch (error) {
      this.logger.warn(
        `OpenMAIC metadata persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
