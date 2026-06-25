import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import express, { Express } from 'express';
import { AppModule } from './app.module';

let cached: Express | null = null;

/**
 * Create (once) and return an Express instance with the Nest app mounted.
 * Used by the Vercel serverless function (api/index.ts). The instance is
 * cached at module scope so warm invocations skip the bootstrap.
 */
export async function createServer(): Promise<Express> {
  if (cached) return cached;

  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: ['error', 'warn'],
  });
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }),
  );
  await app.init();

  cached = expressApp;
  return expressApp;
}
