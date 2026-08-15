import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { AuthGuard } from './common/guards/auth.guard';
import { AuthService } from './modules/auth/auth.service';
import 'dotenv/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

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
  app.useGlobalInterceptors(
    new TransformInterceptor(),
    new AuditLogInterceptor(),
  );

  // Apply AuthGuard globally
  const reflector = app.get(Reflector);
  const authService = app.get(AuthService);
  const authGuard = new AuthGuard(reflector, authService);
  app.useGlobalGuards(authGuard);

  // Swagger / OpenAPI: disabled in production
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NotaryDay API')
      .setDescription(
        'Backend API for NotaryDay, the mobile notary scheduling & profitability platform',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth', 'Registration, login, password reset')
      .addTag('Users', 'Profile & settings management')
      .addTag('Jobs', 'Signing job CRUD')
      .addTag('Bookings', 'Public booking page & booking management')
      .addTag('Planner', 'Route optimisation & gap finder')
      .addTag('CITT', 'Can I Take This? profitability check')
      .addTag('Billing', 'Subscription & checkout')
      .addTag('Expenses', 'Expense tracking')
      .addTag('Invoices', 'Invoice generation & sending')
      .addTag('Reports', 'Earnings, mileage & tax reports')
      .addTag('Notifications', 'Email notifications')
      .addTag('Calendar', 'iCal feed & Google Calendar sync')
      .addTag('Email Templates', 'Custom email template management')
      .addTag('Job Import', 'Parse jobs from forwarded emails or screenshots')
      .addTag('Journal', 'Notarial journal entries')
      .addTag('Health', 'Health check')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);

    // Add global 401 response to all endpoints that use BearerAuth
    for (const path of Object.values(document.paths ?? {})) {
      for (const method of Object.values(path as Record<string, any>)) {
        if (method.security?.some((s: any) => s.bearer)) {
          method.responses = method.responses ?? {};
          if (!method.responses['401']) {
            method.responses['401'] = {
              description: 'Unauthorized: missing or invalid Bearer token',
            };
          }
        }
      }
    }

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = configService.get<number>('PORT') ?? 4000;
  await app.listen(port);

  logger.log(`Notary Day API running on http://localhost:${port}`);
  if (!isProduction) {
    logger.log(`Swagger docs at http://localhost:${port}/docs`);
  }
  logger.log(
    `Environment: ${configService.get<string>('NODE_ENV') ?? 'development'}`,
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
