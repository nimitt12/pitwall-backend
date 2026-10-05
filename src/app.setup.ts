import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { concurrencyLimit } from './security/concurrency.js';
import { validateSecurityConfig } from './security/config.js';
import { SecurityExceptionFilter } from './security/exception.filter.js';
import { InputValidationPipe } from './security/input-validation.js';
import { RateLimitService } from './security/rate-limit.service.js';

export async function configureApp(app: NestExpressApplication, logRequests = true) {
  const { production, origins } = validateSecurityConfig();
  app.disable('x-powered-by');
  app.set(
    'trust proxy',
    process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',').map((v) => v.trim()) : false,
  );
  app.set('query parser', 'simple');
  app.use(helmet({ strictTransportSecurity: production ? undefined : false }));
  app.use(concurrencyLimit());
  app.use(...(await app.get(RateLimitService).configure()));
  app.enableCors({
    origin: origins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  // Limits execute before parsing so oversized/invalid requests also consume budget.
  app.useBodyParser('json', { limit: '32kb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      ((req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') ||
        req.headers['transfer-encoding']) &&
      !req.is('application/json')
    ) {
      res.status(415).json({ message: 'Content-Type must be application/json' });
      return;
    }
    // Private responses, including authentication and admin data, must not be cached.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalPipes(new InputValidationPipe());
  app.useGlobalFilters(new SecurityExceptionFilter());
  if (logRequests) {
    const logger = new Logger('HTTP');
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.once('finish', () =>
        logger.log(`${req.method} ${req.route?.path || '<unmatched>'} ${res.statusCode}`),
      );
      next();
    });
  }
  const config = new DocumentBuilder()
    .setTitle('MyPitWall API Documentation')
    .setVersion('1.0.0')
    .setDescription(
      'MyPitWall API. Private routes require bearer authentication; all routes are rate limited.',
    )
    .addBearerAuth(undefined, 'bearerAuth')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  if (!production) SwaggerModule.setup('api-docs', app, document);
  return document;
}
