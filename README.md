# Lumina API Gateway

NestJS + Fastify API gateway for Lumina Learning Hub.

## Features

- Prefix proxy routing for `/auth/*`, `/ai/*`, `/rest/*`, and `/storage/*`
- JWT validation through Supabase JWKS
- Protected-by-default routing with configurable public route exceptions
- Header spoofing scrubbing + trusted claim forwarding
- Redis-backed throttling with fail-open guard behavior
- Unified error envelope: `{ code, message, requestId, details? }`
- Health endpoint at `GET /health`
- Railway-ready container and deployment config

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Run in watch mode:

```bash
npm run start:dev
```

## Scripts

- `npm run build` - Compile TypeScript into `dist/`
- `npm run start` - Run compiled app
- `npm run start:dev` - Run in watch mode
- `npm run test` - Run Jest unit tests
- `npm run test:e2e` - Run focused e2e tests

## Environment Variables

See [.env.example](./.env.example). Required values include:

- Supabase JWT settings: `SUPABASE_JWKS_URI`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`
- Supabase proxy settings: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Upstream services: `AUTH_SERVICE_URL`, `AI_SERVICE_URL`, and other service URLs listed in `.env.example`
- Redis for throttling: `REDIS_URL`
- Rate limit controls: `RATE_LIMIT_*`
- Public exceptions: `PUBLIC_ROUTES`

## Routing

- `GET /health` - Public health check
- `ALL /auth/*` - Proxied to `AUTH_SERVICE_URL`
- `ALL /ai/*` - Proxied to `AI_SERVICE_URL`
- `ALL /rest/*` - Proxied to `${SUPABASE_URL}/rest/v1`
- `ALL /storage/*` - Proxied to `${SUPABASE_URL}/storage/v1`

## Docker

Build and run:

```bash
docker build -t lumina-api-gateway .
docker run --rm -p 3000:3000 --env-file .env lumina-api-gateway
```

## Railway

`railway.json` includes:

- start command: `npm run start:prod`
- health check path: `/health`
