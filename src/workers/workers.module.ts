import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailImportProcessor } from './email-import.processor';
import { InvoiceProcessor } from './invoice.processor';
import { NotificationProcessor } from './notification.processor';
import { CalendarSyncProcessor } from './calendar-sync.processor';
import { NotificationCronService } from './notification-cron.service';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import {
  QUEUE_EMAIL_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
} from '../queues/queue.constants';
import { bullRedisConnection } from '../queues/redis-connection';

const bullConnectionConfig = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => bullRedisConnection(config),
};

@Module({
  imports: [
    BullModule.forRootAsync(bullConnectionConfig),
    BullModule.registerQueue(
      { name: QUEUE_EMAIL_IMPORT },
      { name: QUEUE_INVOICE },
      { name: QUEUE_NOTIFICATION },
      { name: QUEUE_CALENDAR_SYNC },
    ),
    NotificationsModule,
  ],
  providers: [
    EmailImportProcessor,
    InvoiceProcessor,
    NotificationProcessor,
    CalendarSyncProcessor,
    NotificationCronService,
  ],
})
export class WorkersModule {}
