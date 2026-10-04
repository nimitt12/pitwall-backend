import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import 'dotenv/config';
import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 8080);
  await app.listen(port);
  Logger.log(`Server is running on ${await app.getUrl()}`, 'Bootstrap');
}

bootstrap().catch((error) => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exitCode = 1;
});
