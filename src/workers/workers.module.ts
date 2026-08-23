import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JobImportProcessor } from './job-import.processor';
import { InvoiceProcessor } from './invoice.processor';
import { NotificationProcessor } from './notification.processor';
import { CalendarSyncProcessor } from './calendar-sync.processor';
import { NotificationCronService } from './notification-cron.service';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { UsersModule } from '../modules/users/users.module';
import { EmailTemplatesModule } from '../modules/email-templates/email-templates.module';
import { CalendarModule } from '../modules/calendar/calendar.module';
import { BillingModule } from '../modules/billing/billing.module';
import { BillingWebhookProcessor } from './billing-webhook.processor';
import { InvoiceRetryCronService } from './invoice-retry-cron.service';
import { SoftDeletePurgeService } from './soft-delete-purge.service';
import {
  QUEUE_JOB_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
  QUEUE_BILLING_WEBHOOK,
} from '../queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_JOB_IMPORT },
      { name: QUEUE_INVOICE },
      { name: QUEUE_NOTIFICATION },
      { name: QUEUE_CALENDAR_SYNC },
      { name: QUEUE_BILLING_WEBHOOK },
    ),
    NotificationsModule,
    UsersModule,
    EmailTemplatesModule,
    CalendarModule,
    BillingModule,
  ],
  providers: [
    JobImportProcessor,
    InvoiceProcessor,
    NotificationProcessor,
    CalendarSyncProcessor,
    NotificationCronService,
    BillingWebhookProcessor,
    InvoiceRetryCronService,
    SoftDeletePurgeService,
  ],
})
export class WorkersModule {}
