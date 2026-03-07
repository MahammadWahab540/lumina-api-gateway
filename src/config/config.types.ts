export type NodeEnv = 'development' | 'test' | 'production';

export interface AuthConfig {
  jwksUri: string;
  issuer: string;
  audience: string;
}

export interface ServiceRouteConfig {
  authServiceUrl: string;
  tenantServiceUrl: string;
  userServiceUrl: string;
  courseServiceUrl: string;
  enrollmentServiceUrl: string;
  assignmentServiceUrl: string;
  skillServiceUrl: string;
  aiServiceUrl: string;
  gamificationServiceUrl: string;
  analyticsServiceUrl: string;
  notificationServiceUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  personalizationServiceUrl: string;
  proxyTimeoutMs: number;
}

export interface RateLimitBucketConfig {
  ttlMs: number;
  limit: number;
  blockDurationMs: number;
}

export interface RateLimitConfig {
  global: RateLimitBucketConfig;
  auth: RateLimitBucketConfig;
  ai: RateLimitBucketConfig;
  rest: RateLimitBucketConfig;
  storage: RateLimitBucketConfig;
}

export interface SecurityConfig {
  allowedOrigins: string[];
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: string;
  bodyLimitMb: number;
  corsOrigins: string[];
  publicRoutes: string[];
  auth: AuthConfig;
  security: SecurityConfig;
  redisUrl: string;
  services: ServiceRouteConfig;
  rateLimit: RateLimitConfig;
}
