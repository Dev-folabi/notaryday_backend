import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import Redis from 'ioredis';
import helmet from 'helmet';
import csurf from 'csurf';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AuthGuard } from './common/guards/auth.guard';
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
  app.enableCors({
    origin: configService.get<string>('APP_URL') ?? 'http://localhost:4000',
    credentials: true,
  });

  // Session with Redis store (Upstash via ioredis)
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
      'Redis connection failed, continuing without session store:',
      err instanceof Error ? err.message : err,
    );
  }

  app.use(
    session({
      store: new RedisStore({ client: redisClient }),
      secret:
        configService.get<string>('SESSION_SECRET') ??
        'dev-secret-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: configService.get<string>('NODE_ENV') === 'production',
        maxAge: 24 * 60 * 60 * 1000, // 24h default
        sameSite: 'lax',
      },
    }),
  );

  // CSRF — exclude inbound email webhook, Lemon Squeezy webhook, and health check (they use HMAC/special auth)
  app.use((req: any, res: any, next: () => void) => {
    const excluded = [
      '/api/v1/email-import/inbound',
      '/api/v1/billing/webhook',
      '/api/v1/health',
    ];
    if (
      excluded.some((path) => (req as { path: string }).path.startsWith(path))
    ) {
      return next();
    }
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes((req as { method: string }).method)
    ) {
      return next();
    }
    return (
      csurf({ cookie: false }) as (
        req: any,
        res: any,
        next: (err?: any) => void,
      ) => void
    )(req, res, next);
  });

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
  const authGuard = new AuthGuard(reflector);
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
