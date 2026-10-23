import { Module } from '@nestjs/common';
import { RaceController } from './race.controller.js';
import { RaceService } from './race.service.js';

@Module({
  controllers: [RaceController],
  providers: [RaceService],
  exports: [RaceService],
})
export class RaceModule {}
