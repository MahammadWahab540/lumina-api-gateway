import { Module } from '@nestjs/common';
import { OpenMaicController } from './openmaic.controller';
import { OpenMaicService } from './openmaic.service';

@Module({
  controllers: [OpenMaicController],
  providers: [OpenMaicService],
})
export class OpenMaicModule {}
