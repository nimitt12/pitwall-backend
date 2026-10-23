import { Module } from '@nestjs/common';
import { ResultController } from './result.controller.js';
import { ResultService } from './result.service.js';

@Module({
  controllers: [ResultController],
  providers: [ResultService],
  exports: [ResultService],
})
export class ResultModule {}
