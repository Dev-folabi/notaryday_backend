import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './config/prisma.module';
import { RedisModule } from './config/redis.module';
import { QueueModule } from './queues/queue.module';
import { bullRedisConnection } from './queues/redis-connection';
import { WorkersModule } from './workers/workers.module';
import { AuthModule } from './modules/auth/auth.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
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
    RedisModule,
    PrismaModule,
    QueueModule,
    AuthModule,
    AnalyticsModule,
    WorkersModule,
  ],
})
export class WorkerAppModule {}
