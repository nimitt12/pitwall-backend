import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class SecurityExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      response.end();
      return;
    }
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (exception as { type?: string })?.type === 'entity.too.large'
          ? 413
          : (exception as { type?: string })?.type === 'entity.parse.failed'
            ? 400
            : 500;
    if (status >= 500) {
      // Never serialize database errors, upstream credentials, or stack traces to clients.
      new Logger('HTTP').error(`Request failed (${status})`);
      response.status(status).json({
        message: status === 503 ? 'Service temporarily unavailable' : 'Internal server error',
      });
    } else {
      const body =
        exception instanceof HttpException
          ? exception.getResponse()
          : { message: 'Invalid request body' };
      response.status(status).json(typeof body === 'string' ? { message: body } : body);
    }
  }
}
