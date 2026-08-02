import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JobImportProcessor } from './job-import.processor';
import { InvoiceProcessor } from './invoice.processor';
import { NotificationProcessor } from './notification.processor';
import { CalendarSyncProcessor } from './calendar-sync.processor';
import { NotificationCronService } from './notification-cron.service';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import {
  QUEUE_JOB_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
} from '../queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_JOB_IMPORT },
      { name: QUEUE_INVOICE },
      { name: QUEUE_NOTIFICATION },
      { name: QUEUE_CALENDAR_SYNC },
    ),
    NotificationsModule,
  ],
  providers: [
    JobImportProcessor,
    InvoiceProcessor,
    NotificationProcessor,
    CalendarSyncProcessor,
    NotificationCronService,
  ],
})
export class WorkersModule {}
