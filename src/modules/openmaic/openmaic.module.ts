import { Module } from '@nestjs/common';
import { OpenMaicController, OpenMaicApiController } from './openmaic.controller';
import { OpenMaicAssetsController } from './openmaic-assets.controller';
import { OpenMaicService } from './openmaic.service';

@Module({
  controllers: [OpenMaicController, OpenMaicAssetsController, OpenMaicApiController],
  providers: [OpenMaicService],
})
export class OpenMaicModule {}
