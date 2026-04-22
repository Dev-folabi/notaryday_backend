import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AuthGuard } from './common/guards/auth.guard';
import { AuthService } from './modules/auth/auth.service';
import 'dotenv/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Security headers
  app.use(helmet());

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS
  const corsOrigin =
    configService.get<string>('APP_URL') ?? 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  logger.log(`CORS enabled for origin: ${corsOrigin}`);

  // Redis store (Upstash via ioredis)
  const redisUrl = configService.get<string>('UPSTASH_REDIS_URL');
  if (!redisUrl) {
    logger.error('UPSTASH_REDIS_URL is not configured');
    process.exit(1);
  }

  const redisClient = new Redis(redisUrl, {
    tls: { rejectUnauthorized: false },
    lazyConnect: true,
  });

  try {
    await redisClient.connect();
    await redisClient.ping();
    logger.log('Redis connected to Upstash');
  } catch (err: any) {
    logger.warn(
      'Redis connection failed, continuing without redis',
      err instanceof Error ? err.message : err,
    );
  }

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global response transform
  app.useGlobalInterceptors(new TransformInterceptor());

  // Apply AuthGuard globally
  const reflector = app.get(Reflector);
  const authService = app.get(AuthService);
  const authGuard = new AuthGuard(reflector, authService);
  app.useGlobalGuards(authGuard);

  const port = configService.get<number>('PORT') ?? 4000;
  await app.listen(port);

  logger.log(`Notary Day API running on http://localhost:${port}`);
  logger.log(
    `Environment: ${configService.get<string>('NODE_ENV') ?? 'development'}`,
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
