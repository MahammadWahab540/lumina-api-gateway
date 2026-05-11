import type { FastifyHelmetOptions } from '@fastify/helmet';
import { buildCspDirectives } from './csp';

export function buildHelmetOptions(allowedOrigins: string[]): FastifyHelmetOptions {
  return {
    frameguard: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: buildCspDirectives(allowedOrigins),
    },
  };
}
