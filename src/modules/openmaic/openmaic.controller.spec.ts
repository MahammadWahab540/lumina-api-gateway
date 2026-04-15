import { FastifyRequest } from 'fastify';
import { GatewayClaims } from '../auth/auth.types';
import { OpenMaicController } from './openmaic.controller';
import { OpenMaicService } from './openmaic.service';

describe('OpenMaicController', () => {
  const claims: GatewayClaims = {
    userId: 'user-123',
    orgId: 'org-456',
    roles: ['teacher'],
    email: 'teacher@example.com',
    raw: { sub: 'user-123' },
  };

  const request = {
    user: claims,
    headers: {
      'x-forwarded-host': 'classroom.lumina.test',
      'x-forwarded-proto': 'https',
    },
  } as unknown as FastifyRequest & { user: GatewayClaims };

  it('forwards the request context to warmup', async () => {
    const openMaicService = {
      warmup: jest.fn().mockResolvedValue({ status: 'ready' }),
    } as unknown as jest.Mocked<Pick<OpenMaicService, 'warmup'>>;

    const controller = new OpenMaicController(openMaicService as unknown as OpenMaicService);

    await expect(
      (controller as any).warmup(request, {
        stageId: 'stage-1',
        topic: 'Gravity',
      }),
    ).resolves.toEqual({ status: 'ready' });

    expect(openMaicService.warmup).toHaveBeenCalledWith(
      claims,
      {
        stageId: 'stage-1',
        topic: 'Gravity',
      },
      request,
    );
  });

  it('forwards the request context to stage lookup', async () => {
    const openMaicService = {
      getStage: jest.fn().mockResolvedValue({ status: 'ready' }),
    } as unknown as jest.Mocked<Pick<OpenMaicService, 'getStage'>>;

    const controller = new OpenMaicController(openMaicService as unknown as OpenMaicService);

    await expect((controller as any).getStage(request, 'stage-1')).resolves.toEqual({
      status: 'ready',
    });

    expect(openMaicService.getStage).toHaveBeenCalledWith('stage-1', request);
  });

  it('forwards the request context to regeneration', async () => {
    const openMaicService = {
      regenerate: jest.fn().mockResolvedValue({ status: 'warming' }),
    } as unknown as jest.Mocked<Pick<OpenMaicService, 'regenerate'>>;

    const controller = new OpenMaicController(openMaicService as unknown as OpenMaicService);

    await expect(
      (controller as any).regenerate(request, 'stage-1', {
        topic: 'Gravity',
        description: 'Updated classroom',
      }),
    ).resolves.toEqual({ status: 'warming' });

    expect(openMaicService.regenerate).toHaveBeenCalledWith(
      claims,
      'stage-1',
      {
        topic: 'Gravity',
        description: 'Updated classroom',
      },
      request,
    );
  });
});
