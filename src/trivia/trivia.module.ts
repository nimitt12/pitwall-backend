import { Module } from '@nestjs/common';
import { TriviaController } from './trivia.controller.js';
import { TriviaService } from './trivia.service.js';

@Module({
  controllers: [TriviaController],
  providers: [TriviaService],
  exports: [TriviaService],
})
export class TriviaModule {}
