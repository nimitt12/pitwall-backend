import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

import { AdminAuthGuard } from './admin-auth.guard.js';
import { AuthGuard } from './auth.guard.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AdminAuthGuard],
  exports: [AuthGuard, AdminAuthGuard],
})
export class AuthModule {}
