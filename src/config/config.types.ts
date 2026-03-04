export type NodeEnv = 'development' | 'test' | 'production';

export interface AuthConfig {
  jwksUri: string;
  issuer: string;
  audience: string;
}

export interface ServiceRouteConfig {
  authServiceUrl: string;
  aiServiceUrl: string;
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
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  logLevel: string;
  bodyLimitMb: number;
  corsOrigins: string[];
  publicRoutes: string[];
  auth: AuthConfig;
  redisUrl: string;
  services: ServiceRouteConfig;
  rateLimit: RateLimitConfig;
}
