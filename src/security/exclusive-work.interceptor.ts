import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { finalize } from 'rxjs';

/** Serialize admin sync/replay work per instance, including after client disconnects. */
@Injectable()
export class WorkGate {
  readonly running = new Set<string>();
}

@Injectable()
export class ExclusiveWorkInterceptor implements NestInterceptor {
  constructor(private readonly gate: WorkGate) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const key = context.getClass().name === 'LiveController' ? 'replay-load' : 'database-sync';
    if (this.gate.running.has(key)) throw new ConflictException('An operation is already running');
    this.gate.running.add(key);
    return next.handle().pipe(finalize(() => this.gate.running.delete(key)));
  }
}
