/**
 * The Content-Security-Policy directives actually registered by `src/main.ts`
 * at bootstrap. Extracted into a pure function so it's unit-testable without
 * booting the whole Nest/Fastify app.
 *
 * NOTE: `src/security/csp.ts` / `helmet-options.ts` define a *different*,
 * unused CSP — they aren't wired into `main.ts`'s `helmet` registration.
 * This is the one that's actually live in production.
 */
export function buildLiveCspDirectives(
  allowedOrigins: string[],
  openmaicOrigin?: string,
): Record<string, string[]> {
  const extraOrigin = openmaicOrigin ? [openmaicOrigin] : [];

  return {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'https://cdn.jsdelivr.net'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
    'img-src': ["'self'", 'data:', 'blob:', ...allowedOrigins],
    'font-src': ["'self'", 'data:', 'blob:', 'https://frontend-cdn.perplexity.ai', ...allowedOrigins],
    'connect-src': [
      "'self'",
      'https://huggingface.co',
      'https://*.huggingface.co',
      'https://hf.co',
      'https://*.hf.co',
      'https://xethub.hf.co',
      'https://*.xethub.hf.co',
      'https://cdn-lfs.huggingface.co',
      'https://cdn.jsdelivr.net',
      ...allowedOrigins,
      ...extraOrigin,
    ],
    'media-src': ["'self'", 'blob:', 'data:', ...extraOrigin],
    'worker-src': ["'self'", 'blob:'],
    'frame-ancestors': ["'self'", ...allowedOrigins],
  };
}

/** Origin (scheme + host [+ port]) of a service URL, or `undefined` if it can't be parsed. */
export function safeOrigin(serviceUrl: string): string | undefined {
  try {
    return new URL(serviceUrl).origin;
  } catch {
    return undefined;
  }
}
