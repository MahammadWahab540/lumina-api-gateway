import 'fastify';

declare module 'fastify' {
  interface FastifyReply {
    from(url: string, options?: Record<string, unknown>): Promise<unknown>;
  }
}
