import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';import Redis from 'ioredis';
import * as crypto from 'crypto';
import { APP_CONFIG } from '../../config/config.constants';
import { AppConfig } from '../../config/config.types';
import { GatewayClaims } from '../auth/auth.types';
import { WarmupClassroomRequest, WarmupClassroomResponse } from './openmaic.types';
import { FastifyRequest } from 'fastify';

type RequestContext = Pick<FastifyRequest, 'headers'>;
type UpstreamPayload = Record<string, unknown>;

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

import { OnModuleDestroy } from '@nestjs/common';
@Injectable()
export class OpenMaicService implements OnModuleDestroy {
  private readonly logger = new Logger(OpenMaicService.name);
  private readonly supabaseServiceRoleKey: string | null;
  private readonly redis: Redis;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.redis = new Redis(this.config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
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
    const isNewPayload = request.courseId || request.lessonId || request.userId;

    if (isNewPayload) {
      // Validate new payload constraints
      if (claims.userId !== request.userId) {
        throw new HttpException({ code: 'FORBIDDEN', message: 'User mismatch' }, 403);
      }
      if (!claims.roles || !claims.roles.includes('student')) {
        throw new HttpException({ code: 'FORBIDDEN', message: 'Student role required' }, 403);
      }
      if (!claims.tenantId) {
        throw new HttpException({ code: 'FORBIDDEN', message: 'Tenant ID missing from claims' }, 403);
      }

      const payload = {
        tenantId: claims.tenantId,
        courseId: request.courseId,
        lessonId: request.lessonId,
        userId: request.userId,
      };

      const startedAt = Date.now();
      try {
        const response = await this.sendRequest<any>(
          '/v1/classroom-jobs',
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
          requestContext,
        );

        // Ensure successful warmup returns 202 status: "warming" + jobId
        this.logger.log(JSON.stringify({ msg: 'openmaic_warmup_new', status: 'warming', durationMs: Date.now() - startedAt }));

        return {
          status: 'warming',
          jobId: response.jobId || response.id,
          pollUrl: `/openmaic/proxy/api/classroom-job/${response.jobId || response.id}`,
        } as any;
      } catch (err: any) {
        // Fallback for timeout / 5xx / network error
        const status = err instanceof HttpException ? err.getStatus() : 500;
        if (status >= 500 || err instanceof GatewayTimeoutException || err.name === 'GatewayTimeoutException') {
          return {
            status: 'fallback',
            fallback: true,
            reason: 'upstream_unavailable',
            embedUrl: null,
          } as any;
        }
        throw err;
      }
    }

    if (!request.stageId || !request.topic) {
      throw new BadRequestException('Missing required fields: stageId, topic');
    }

    const startedAt = Date.now();
    const response = await this.sendRequest<WarmupClassroomResponse>(
      '/api/warmup-classroom',
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
      requestContext,
    );

    // Map the status from OpenMAIC to the response format and rewrite URLs
    const processedResponse = this.rewriteResponseUrls(response);

    // Run persistence in background to avoid blocking
    this.persistMetadata(claims, request, processedResponse).catch((err) =>
      this.logger.warn(`Background metadata persistence failed: ${err.message}`),
    );

    this.logger.log(
      JSON.stringify({
        msg: 'openmaic_warmup',
        stageId: request.stageId,
        status: processedResponse.status,
        durationMs: Date.now() - startedAt,
      }),
    );

    return processedResponse;
  }

  getEmbedUrl(claims: GatewayClaims, courseId: string, lessonId: string) {
    if (!claims.tenantId) {
      throw new HttpException({ code: 'FORBIDDEN', message: 'Missing tenantId' }, 403);
    }

    const tenantId = claims.tenantId;
    const userId = claims.userId;
    const exp = Math.floor(Date.now() / 1000) + this.config.services.openmaicEmbedTtlSeconds;

    const canonicalString = `tenantId=${tenantId}&userId=${userId}&courseId=${courseId}&lessonId=${lessonId}&exp=${exp}`;
    const signature = crypto
      .createHmac('sha256', this.config.services.openmaicEmbedSigningSecret)
      .update(canonicalString)
      .digest('hex');

    const gatewayBase = this.config.services.luminaGatewayUrl.replace(/\/+$/, '');
    const embedUrl = `${gatewayBase}/openmaic/proxy/embed?${canonicalString}&sig=${signature}`;

    return {
      embedUrl,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  async getStage(stageId: string, requestContext?: RequestContext): Promise<WarmupClassroomResponse> {
    if (!stageId) {
      throw new BadRequestException('Missing required parameter: stageId');
    }

    const startedAt = Date.now();
    const response = await this.sendRequest<WarmupClassroomResponse>(
      `/api/stages/${encodeURIComponent(stageId)}`,
      {
        method: 'GET',
      },
      requestContext,
    );

    const processedResponse = this.rewriteResponseUrls(response);

    this.logger.log(
      JSON.stringify({
        msg: 'openmaic_stage_lookup',
        stageId,
        status: processedResponse.status,
        durationMs: Date.now() - startedAt,
      }),
    );

    return processedResponse;
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
      `/api/stages/${encodeURIComponent(stageId)}/regenerate`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
      requestContext,
    );

    const processedResponse = this.rewriteResponseUrls(response);

    // Run persistence in background to avoid blocking
    this.persistMetadata(
      claims,
      {
        ...request,
        stageId,
      },
      processedResponse,
    ).catch((err) =>
      this.logger.warn(`Background metadata persistence failed: ${err.message}`),
    );

    this.logger.log(
      JSON.stringify({
        msg: 'openmaic_regenerate',
        stageId,
        status: processedResponse.status,
        durationMs: Date.now() - startedAt,
      }),
    );

    return processedResponse;
  }

  private buildTargetUrl(pathname: string): string {
    const normalizedBase = this.config.services.openmaicServiceUrl.replace(/\/+$/, '');
    const normalizedPath = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    return `${normalizedBase}/${normalizedPath}`;
  }

  private buildRequestHeaders(
    initHeaders: any,
    requestContext?: RequestContext,
    isProxy: boolean = false,
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // 1. Initial headers from caller
    if (initHeaders) {
      if (typeof initHeaders.forEach === 'function') {
        initHeaders.forEach((v: any, k: any) => {
          headers[k.toLowerCase()] = String(v);
        });
      } else if (Array.isArray(initHeaders)) {
        initHeaders.forEach(([k, v]) => {
          headers[k.toLowerCase()] = String(v);
        });
      } else {
        Object.entries(initHeaders).forEach(([k, v]) => {
          if (v !== undefined && v !== null) {
            headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : String(v);
          }
        });
      }
    }

    // 2. Identity propagation from request context
    if (requestContext?.headers) {
      const propagate = ['x-org-id', 'x-user-id', 'x-request-id', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for'];
      for (const h of propagate) {
        const val = requestContext.headers[h];
        if (val) {
          headers[h] = Array.isArray(val) ? val[0] : val;
        }
      }
    }

    // 3. Inject internal service key for authentication
    const secret = this.config.services.internalServiceKey;
    if (secret) {
      // OpenMAIC expects 'x-api-key' for its authentication middleware
      headers['x-api-key'] = secret;
      headers['x-internal-secret'] = secret;
    }

    // 4. Force JSON for internal API calls
    if (!isProxy) {
      headers['accept'] = 'application/json';
      headers['content-type'] = 'application/json';
    }

    return headers;
  }

  async proxyRequest(
    path: string,
    method: string,
    headers: Record<string, string>,
    body?: any,
    request?: FastifyRequest,
  ): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
    const isJobCacheable = method.toUpperCase() === 'GET' && path.match(/^api\/classroom-job\/([^\/]+)$/);
    let cacheKey = '';

    if (isJobCacheable) {
      const match = path.match(/^api\/classroom-job\/([^\/]+)$/);
      const jobId = match ? match[1] : '';
      if (jobId) {
        cacheKey = `openmaic:classroom-job:${jobId}`;
        try {
          const cached = await this.redis.get(cacheKey);
          if (cached) {
            this.logger.debug(`Cache hit for ${cacheKey}`);
            return {
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: Buffer.from(cached),
            };
          }
        } catch (err) {
          this.logger.warn(`Redis cache error for ${cacheKey}: ${err}`);
        }
      }
    }
    // 1. Handle Path Mapping (e.g., stages/[id] -> classroom/[id] for UI requests)
    let targetPath = path;
    const isDocumentRequest = headers['accept']?.includes('text/html');

    if (isDocumentRequest && path.startsWith('stages/')) {
      const stageId = path.split('/')[1];
      if (stageId) {
        targetPath = `classroom/${stageId}`;
        this.logger.debug(`Mapping proxy path: ${path} -> ${targetPath}`);
      }
    }

    // 2. Extract search params from original request URL if available
    const search = request?.raw.url?.includes('?') ? `?${request.raw.url.split('?')[1]}` : '';
    const url = `${this.buildTargetUrl(targetPath)}${search}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.services.proxyTimeoutMs);

    try {
      this.logger.debug(`Proxying request: ${method} ${url}`);
      const response = await fetch(url, {
        method,
        headers: this.buildRequestHeaders(headers, request, true),
        body: (body ? (Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body)) : undefined) as any,
        signal: controller.signal,
      });

      const responseBody = await response.arrayBuffer();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        // Skip headers that might cause issues with proxying or conflict with gateway policies
        const lowerKey = key.toLowerCase();
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'x-frame-options'].includes(lowerKey)) {
          responseHeaders[key] = value;
        }
      });

      const resultBuffer = Buffer.from(responseBody);

      if (cacheKey && response.status === 200) {
        try {
          const parsed = JSON.parse(resultBuffer.toString('utf8'));
          if (parsed && (parsed.status === 'succeeded' || parsed.status === 'ready' || parsed.status === 'completed')) {
            // Normalise response
            const normalized = {
              status: parsed.status,
              result: { classroomId: parsed.classroomId || parsed.result?.classroomId },
              error: null,
            };
            await this.redis.setex(cacheKey, 60, JSON.stringify(normalized));
            return {
              status: 200,
              headers: { 'content-type': 'application/json' },
              body: Buffer.from(JSON.stringify(normalized)),
            };
          }
        } catch (err) {
          // Parsing failed, don't cache
        }
      }

      return {
        status: response.status,
        headers: responseHeaders,
        body: resultBuffer,
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
    const targetUrl = this.buildTargetUrl(pathname);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.services.proxyTimeoutMs);

    try {
      this.logger.debug(`Contacting OpenMAIC upstream: ${targetUrl}`);
      const response = await fetch(targetUrl, {
        ...init,
        headers: this.buildRequestHeaders(init.headers, requestContext),
        signal: controller.signal,
      });

      this.logger.debug(
        `OpenMAIC Response: status=${response.status}, ok=${response.ok}, url=${response.url}`,
      );

      const rawBody = await response.text();
      const payload = this.parseUpstreamPayload(rawBody);

      if (!response.ok || (payload !== null && payload.success === false)) {
        const status = response.status >= 400 ? (response.status >= 500 ? 502 : response.status) : response.status;
        throw new HttpException(
          {
            code: 'OPENMAIC_UPSTREAM_ERROR',
            message: `${this.getUpstreamErrorMessage(payload, rawBody, response.status)} (Upstream: ${targetUrl})`,
            ...(payload?.details !== undefined ? { details: payload.details } : {}),
            upstreamUrl: targetUrl,
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

  private rewriteResponseUrls(response: WarmupClassroomResponse): WarmupClassroomResponse {
    if (!response.embedUrl) {
      return response;
    }

    const gatewayBase = this.config.services.luminaGatewayUrl.replace(/\/+$/, '');
    const upstreamBase = this.config.services.openmaicServiceUrl.replace(/\/+$/, '');

    // Robust replacement: replace the origin and normalize to /openmaic/proxy
    let rewrittenEmbedUrl = response.embedUrl;
    const proxyPrefix = `${gatewayBase}/openmaic/proxy`;

    if (rewrittenEmbedUrl.startsWith(upstreamBase)) {
        // Remove upstream base and ensure exactly one slash after proxy prefix
        const subPath = rewrittenEmbedUrl.slice(upstreamBase.length).replace(/^\/+/, '');
        rewrittenEmbedUrl = `${proxyPrefix}/${subPath}`;
    } else {
        // Fallback for different protocol or port
        try {
            const url = new URL(response.embedUrl);
            const subPath = url.pathname.replace(/^\/+/, '');
            rewrittenEmbedUrl = `${proxyPrefix}/${subPath}${url.search}`;
        } catch (e) {
            this.logger.warn(`Failed to parse embedUrl for rewrite: ${response.embedUrl}`);
        }
    }

    return {
      ...response,
      embedUrl: rewrittenEmbedUrl,
    };
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
