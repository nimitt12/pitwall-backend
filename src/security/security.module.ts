import { Global, Module } from '@nestjs/common';
import { ExclusiveWorkInterceptor, WorkGate } from './exclusive-work.interceptor.js';
import { RateLimitService } from './rate-limit.service.js';

@Global()
@Module({
  providers: [RateLimitService, ExclusiveWorkInterceptor, WorkGate],
  exports: [RateLimitService, ExclusiveWorkInterceptor, WorkGate],
})
export class SecurityModule {}
