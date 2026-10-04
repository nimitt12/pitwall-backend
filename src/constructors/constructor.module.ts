import { Module } from '@nestjs/common';
import { ConstructorController } from './constructor.controller.js';
import { ConstructorService } from './constructor.service.js';

@Module({
  controllers: [ConstructorController],
  providers: [ConstructorService],
  exports: [ConstructorService],
})
export class ConstructorModule {}
