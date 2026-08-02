import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { AppConfigModule } from './config/config.module';
import { RedisModule } from './config/redis.module';
import { PrismaModule } from './config/prisma.module';
import { QueueModule } from './queues/queue.module';
import { bullRedisConnection } from './queues/redis-connection';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BillingModule } from './modules/billing/billing.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { CittModule } from './modules/citt/citt.module';
import { OrsModule } from './common/services/ors.module';
import { PlannerModule } from './modules/planner/planner.module';
import { BookingModule } from './modules/booking/booking.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { JobImportModule } from './modules/job-import/job-import.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ReportsModule } from './modules/reports/reports.module';
import { JournalModule } from './modules/journal/journal.module';
import { EmailTemplatesModule } from './modules/email-templates/email-templates.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [
    // Config
    AppConfigModule,

    // Rate limiting
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLER_TTL') ?? 60000,
          limit: config.get<number>('THROTTLER_LIMIT') ?? 100,
        },
      ],
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // BullMQ (Redis connection parsed from UPSTASH_REDIS_URL)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...bullRedisConnection(config),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
    }),

    // Core
    RedisModule,
    PrismaModule,
    QueueModule,

    // Domain modules
    AuthModule,
    UsersModule,
    HealthModule,
    NotificationsModule,
    BillingModule,
    GeocodingModule,
    JobsModule,
    CittModule,
    OrsModule,
    PlannerModule,
    BookingModule,
    CalendarModule,
    JobImportModule,
    ExpensesModule,
    InvoicesModule,
    ReportsModule,
    JournalModule,
    EmailTemplatesModule,
    WorkersModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
