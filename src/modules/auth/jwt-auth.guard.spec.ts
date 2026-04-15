import { ExecutionContext, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GatewayClaims } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const supabaseTokenValidator = {
    validateAccessToken: jest.fn<Promise<GatewayClaims | null>, [string]>(),
  };

  const config = {
    publicRoutes: ['/auth/login', '/auth/refresh'],
  } as never;

  beforeEach(() => {
    jest.restoreAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    supabaseTokenValidator.validateAccessToken.mockReset().mockResolvedValue(null);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  function createContext(url = '/auth/context', authorization?: string): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          raw: { url },
          url,
          headers: {
            ...(authorization ? { authorization } : {}),
          },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('translates unknown strategy failures into a structured service-unavailable error', async () => {
    const guard = new JwtAuthGuard(reflector, config, supabaseTokenValidator as never);
    const parentCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockRejectedValue(new Error('Unknown authentication strategy "supabase"'));

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(guard.canActivate(createContext())).rejects.toMatchObject({
      response: {
        code: 'AUTH_STRATEGY_UNAVAILABLE',
        details: { strategy: 'supabase' },
      },
    });

    expect(parentCanActivate).toHaveBeenCalled();
  });

  it('skips auth for configured public routes', async () => {
    const guard = new JwtAuthGuard(reflector, config, supabaseTokenValidator as never);
    const parentCanActivate = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');

    await expect(guard.canActivate(createContext('/auth/login'))).resolves.toBe(true);
    expect(parentCanActivate).not.toHaveBeenCalled();
  });

  it('accepts the request when Supabase token introspection validates the bearer token', async () => {
    const guard = new JwtAuthGuard(reflector, config, supabaseTokenValidator as never);
    jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockRejectedValue(new Error('Unauthorized'));
    supabaseTokenValidator.validateAccessToken.mockResolvedValue({
      userId: 'user-123',
      orgId: 'org-456',
      roles: ['student'],
      email: 'user@example.com',
      raw: { sub: 'user-123' },
    });

    await expect(
      guard.canActivate(createContext('/openmaic/classrooms/warmup', 'Bearer fallback-token')),
    ).resolves.toBe(true);

    expect(supabaseTokenValidator.validateAccessToken).toHaveBeenCalledWith('fallback-token');
  });
});
