import { Module } from '@nestjs/common';
import { LiveTimingService } from './live-timing.service.js';
import { LiveController } from './live.controller.js';

@Module({
  controllers: [LiveController],
  providers: [LiveTimingService],
  exports: [LiveTimingService],
})
export class LiveModule {}
