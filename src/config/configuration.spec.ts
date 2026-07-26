import { loadConfiguration } from './configuration';

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:3000,https://app.pathwisse.com',
    SUPABASE_JWKS_URI: 'https://example.supabase.co/auth/v1/.well-known/jwks.json',
    SUPABASE_JWT_ISSUER: 'https://example.supabase.co/auth/v1',
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    REDIS_URL: 'redis://localhost:6379',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    OPENMAIC_SERVICE_URL: 'http://localhost:8000',
    VOICE_AGENT_INTERNAL_SECRET: 'voice-secret',
    INTERNAL_SERVICE_KEY: 'internal-secret',
  };
}

describe('loadConfiguration CORS', () => {
  it('uses CORS_ORIGINS as the single exact-origin source', () => {
    const config = loadConfiguration({
      ...baseEnv(),
      ALLOWED_ORIGINS: 'https://untrusted.example',
    });

    expect(config.corsOrigins).toEqual(['http://localhost:3000', 'https://app.pathwisse.com']);
    expect(config.security.allowedOrigins).toEqual(config.corsOrigins);
    expect(config.security.allowedOrigins).not.toContain('https://untrusted.example');
  });

  it('rejects wildcard CORS in production', () => {
    expect(() =>
      loadConfiguration({
        ...baseEnv(),
        NODE_ENV: 'production',
        CORS_ORIGINS: '*',
      }),
    ).toThrow('CORS_ORIGINS cannot contain a wildcard in production');
  });

  it('rejects paths where an exact origin is required', () => {
    expect(() =>
      loadConfiguration({
        ...baseEnv(),
        CORS_ORIGINS: 'https://app.pathwisse.com/dashboard',
      }),
    ).toThrow('CORS_ORIGINS must contain exact HTTP(S) origins only');
  });
});
