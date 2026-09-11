import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { QueueModule } from './queues/queue.module';
import { bullRedisConnection } from './queues/redis-connection';
import { MarketingDbModule } from './modules/marketing/db/marketing-db.module';
import { MarketingWorkersModule } from './workers/marketing/marketing-workers.module';

/**
 * Root module for the marketing worker process. Deliberately avoids
 * PrismaModule/RedisModule — this process only needs Redis (BullMQ)
 * and MongoDB.
 */
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
    QueueModule,
    MarketingDbModule,
    MarketingWorkersModule,
  ],
})
export class MarketingWorkerAppModule {}
