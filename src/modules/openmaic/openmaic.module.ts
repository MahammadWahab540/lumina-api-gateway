import { Module } from '@nestjs/common';
import { OpenMaicController } from './openmaic.controller';
import { OpenMaicAssetsController } from './openmaic-assets.controller';
import { OpenMaicService } from './openmaic.service';

@Module({
  controllers: [OpenMaicController, OpenMaicAssetsController],
  providers: [OpenMaicService],
})
export class OpenMaicModule {}
