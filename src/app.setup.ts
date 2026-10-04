import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

/** Shared by production bootstrap and HTTP tests to exercise identical setup. */
export function configureApp(app: NestExpressApplication, logRequests = true) {
  app.enableCors();
  // The original API accepted JSON only, with Express's default 100 KB limit.
  app.useBodyParser('json', { limit: '100kb' });
  if (logRequests) {
    const logger = new Logger('HTTP');
    app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.log(`${req.method} ${req.url}`);
      next();
    });
  }
  const config = new DocumentBuilder()
    .setTitle('MyPitWall API Documentation')
    .setVersion('1.0.0')
    .setDescription('API documentation for the MyPitWall dashboard backend.')
    .addBearerAuth(undefined, 'bearerAuth')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);
  return document;
}
