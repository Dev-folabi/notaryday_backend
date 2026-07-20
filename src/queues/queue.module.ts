import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  QUEUE_EMAIL_IMPORT,
  QUEUE_SCREENSHOT_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
} from './queue.constants';
import { bullRedisConnection } from './redis-connection';

export const bullConnectionConfig = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => bullRedisConnection(config),
};

@Module({
  imports: [
    BullModule.forRootAsync(bullConnectionConfig),
    BullModule.registerQueue(
      { name: QUEUE_EMAIL_IMPORT },
      { name: QUEUE_SCREENSHOT_IMPORT },
      { name: QUEUE_INVOICE },
      { name: QUEUE_NOTIFICATION },
      { name: QUEUE_CALENDAR_SYNC },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
