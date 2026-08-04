import { buildLiveCspDirectives, safeOrigin } from './live-csp';

describe('buildLiveCspDirectives', () => {
  const allowedOrigins = ['https://app.pathwisse.com', 'http://localhost:8080'];

  it('allows the OpenMAIC origin in media-src so classroom audio/video elements can load it', () => {
    const directives = buildLiveCspDirectives(allowedOrigins, 'https://openmaic-mcp-claude-production.up.railway.app');

    expect(directives['media-src']).toContain('https://openmaic-mcp-claude-production.up.railway.app');
  });

  it('allows the OpenMAIC origin in connect-src (fetch/XHR before blob creation)', () => {
    const directives = buildLiveCspDirectives(allowedOrigins, 'https://openmaic-mcp-claude-production.up.railway.app');

    expect(directives['connect-src']).toContain('https://openmaic-mcp-claude-production.up.railway.app');
  });

  it('omits the OpenMAIC origin entirely when it cannot be determined', () => {
    const directives = buildLiveCspDirectives(allowedOrigins, undefined);

    expect(directives['media-src']).toEqual(["'self'", 'blob:', 'data:']);
    expect(directives['connect-src']).not.toContain(undefined);
  });

  it('preserves every previously-existing media-src entry (self, blob, data)', () => {
    const directives = buildLiveCspDirectives(allowedOrigins, 'https://openmaic.example');

    expect(directives['media-src']).toEqual(
      expect.arrayContaining(["'self'", 'blob:', 'data:', 'https://openmaic.example']),
    );
  });

  it('preserves every previously-existing connect-src entry', () => {
    const directives = buildLiveCspDirectives(allowedOrigins, 'https://openmaic.example');

    expect(directives['connect-src']).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://huggingface.co',
        'https://*.huggingface.co',
        'https://hf.co',
        'https://*.hf.co',
        'https://xethub.hf.co',
        'https://*.xethub.hf.co',
        'https://cdn-lfs.huggingface.co',
        'https://cdn.jsdelivr.net',
        'https://app.pathwisse.com',
        'http://localhost:8080',
        'https://openmaic.example',
      ]),
    );
  });

  it('preserves the other, unrelated directives untouched', () => {
    const directives = buildLiveCspDirectives(allowedOrigins, 'https://openmaic.example');

    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual([
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      'blob:',
      'https://cdn.jsdelivr.net',
    ]);
    expect(directives['style-src']).toEqual(["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net']);
    expect(directives['img-src']).toEqual(["'self'", 'data:', 'blob:', ...allowedOrigins]);
    expect(directives['font-src']).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://frontend-cdn.perplexity.ai',
      ...allowedOrigins,
    ]);
    expect(directives['worker-src']).toEqual(["'self'", 'blob:']);
    expect(directives['frame-ancestors']).toEqual(["'self'", ...allowedOrigins]);
  });

  it('spreads all configured allowedOrigins into img-src, font-src, connect-src and frame-ancestors', () => {
    const directives = buildLiveCspDirectives(allowedOrigins, undefined);

    for (const origin of allowedOrigins) {
      expect(directives['img-src']).toContain(origin);
      expect(directives['font-src']).toContain(origin);
      expect(directives['connect-src']).toContain(origin);
      expect(directives['frame-ancestors']).toContain(origin);
    }
  });
});

describe('safeOrigin', () => {
  it('extracts the origin from a service URL', () => {
    expect(safeOrigin('https://openmaic-mcp-claude-production.up.railway.app/base/path')).toBe(
      'https://openmaic-mcp-claude-production.up.railway.app',
    );
  });

  it('returns undefined for an unparsable URL instead of throwing', () => {
    expect(safeOrigin('not-a-url')).toBeUndefined();
  });
});
