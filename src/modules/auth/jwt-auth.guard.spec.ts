import { ExecutionContext, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const config = {
    publicRoutes: ['/auth/login', '/auth/refresh'],
  } as never;

  beforeEach(() => {
    jest.restoreAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  function createContext(url = '/auth/context'): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          raw: { url },
          url,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('translates unknown strategy failures into a structured service-unavailable error', async () => {
    const guard = new JwtAuthGuard(reflector, config);
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
    const guard = new JwtAuthGuard(reflector, config);
    const parentCanActivate = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');

    await expect(guard.canActivate(createContext('/auth/login'))).resolves.toBe(true);
    expect(parentCanActivate).not.toHaveBeenCalled();
  });
});
