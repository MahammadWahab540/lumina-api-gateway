import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

interface GatewayErrorEnvelope {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const requestId =
      (typeof request.headers['x-request-id'] === 'string' && request.headers['x-request-id']) ||
      request.id ||
      'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Unexpected gateway error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const obj = payload as Record<string, unknown>;
        if (typeof obj.message === 'string') {
          message = obj.message;
        } else if (Array.isArray(obj.message) && obj.message.length > 0) {
          message = String(obj.message[0]);
          details = obj.message;
        }

        if (typeof obj.code === 'string') {
          code = obj.code;
        }

        if ('details' in obj) {
          details = obj.details;
        }
      }

      if (code === 'INTERNAL_SERVER_ERROR') {
        code = HttpStatus[status] ?? 'HTTP_ERROR';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      details = { name: exception.name };
      this.logger.error(exception.message, exception.stack);
    }

    const body: GatewayErrorEnvelope = {
      code,
      message,
      requestId,
      ...(details !== undefined ? { details } : {}),
    };

    response.status(status).send(body);
  }
}
