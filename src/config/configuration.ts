import { z } from 'zod';
import { AppConfig, NodeEnv } from './config.types';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().trim().min(1).default('info'),
  BODY_LIMIT_MB: z.coerce.number().int().min(1).default(2),
  CORS_ORIGINS: z.string().trim().default('*'),
  SUPABASE_JWKS_URI: z.string().url(),
  SUPABASE_JWT_ISSUER: z.string().url(),
  SUPABASE_JWT_AUDIENCE: z.string().trim().min(1),
  REDIS_URL: z.string().url(),
  AUTH_SERVICE_URL: z.string().url(),
  TENANT_SERVICE_URL: z.string().url(),
  USER_SERVICE_URL: z.string().url(),
  COURSE_SERVICE_URL: z.string().url(),
  ENROLLMENT_SERVICE_URL: z.string().url(),
  ASSIGNMENT_SERVICE_URL: z.string().url(),
  SKILL_SERVICE_URL: z.string().url(),
  AI_SERVICE_URL: z.string().url(),
  GAMIFICATION_SERVICE_URL: z.string().url(),
  ANALYTICS_SERVICE_URL: z.string().url(),
  NOTIFICATION_SERVICE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  STORAGE_SERVICE_URL: z.string().url(),
  PERSONALIZATION_SERVICE_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().trim().default('*'),
  PROXY_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
  RATE_LIMIT_GLOBAL_TTL: z.coerce.number().int().min(100).default(60000),
  RATE_LIMIT_GLOBAL_LIMIT: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_AUTH_TTL: z.coerce.number().int().min(100).default(60000),
  RATE_LIMIT_AUTH_LIMIT: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_AI_TTL: z.coerce.number().int().min(100).default(60000),
  RATE_LIMIT_AI_LIMIT: z.coerce.number().int().min(1).default(20),
  PUBLIC_ROUTES: z.string().trim().default('/auth/login,/auth/refresh'),
});

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function ensureAbsoluteRoutes(routes: string[]): string[] {
  return routes.map((route) => (route.startsWith('/') ? route : `/${route}`));
}

function toRegExpFromPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function isPublicRoute(pathname: string, publicRoutes: string[]): boolean {
  const normalized = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  return publicRoutes.some((pattern) => {
    const candidate = pattern.replace(/\/+$/, '') || '/';
    return toRegExpFromPattern(candidate).test(normalized);
  });
}

export function loadConfiguration(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const data = parsed.data;
  const corsOrigins = splitCsv(data.CORS_ORIGINS);
  const allowedOrigins = splitCsv(data.ALLOWED_ORIGINS);
  const publicRoutes = ensureAbsoluteRoutes(splitCsv(data.PUBLIC_ROUTES));

  return {
    nodeEnv: data.NODE_ENV as NodeEnv,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    bodyLimitMb: data.BODY_LIMIT_MB,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : ['*'],
    publicRoutes,
    auth: {
      jwksUri: data.SUPABASE_JWKS_URI,
      issuer: data.SUPABASE_JWT_ISSUER,
      audience: data.SUPABASE_JWT_AUDIENCE,
    },
    security: {
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ['*'],
    },
    redisUrl: data.REDIS_URL,
    services: {
      authServiceUrl: data.AUTH_SERVICE_URL,
      tenantServiceUrl: data.TENANT_SERVICE_URL,
      userServiceUrl: data.USER_SERVICE_URL,
      courseServiceUrl: data.COURSE_SERVICE_URL,
      enrollmentServiceUrl: data.ENROLLMENT_SERVICE_URL,
      assignmentServiceUrl: data.ASSIGNMENT_SERVICE_URL,
      skillServiceUrl: data.SKILL_SERVICE_URL,
      aiServiceUrl: data.AI_SERVICE_URL,
      gamificationServiceUrl: data.GAMIFICATION_SERVICE_URL,
      analyticsServiceUrl: data.ANALYTICS_SERVICE_URL,
      notificationServiceUrl: data.NOTIFICATION_SERVICE_URL,
      supabaseUrl: data.SUPABASE_URL,
      storageServiceUrl: data.STORAGE_SERVICE_URL,
      personalizationServiceUrl: data.PERSONALIZATION_SERVICE_URL,
      proxyTimeoutMs: data.PROXY_TIMEOUT_MS,
    },
    rateLimit: {
      global: {
        ttlMs: data.RATE_LIMIT_GLOBAL_TTL,
        limit: data.RATE_LIMIT_GLOBAL_LIMIT,
        blockDurationMs: data.RATE_LIMIT_GLOBAL_TTL,
      },
      auth: {
        ttlMs: data.RATE_LIMIT_AUTH_TTL,
        limit: data.RATE_LIMIT_AUTH_LIMIT,
        blockDurationMs: data.RATE_LIMIT_AUTH_TTL,
      },
      ai: {
        ttlMs: data.RATE_LIMIT_AI_TTL,
        limit: data.RATE_LIMIT_AI_LIMIT,
        blockDurationMs: data.RATE_LIMIT_AI_TTL,
      },
    },
  };
}
