import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import {
  QUEUE_JOB_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
  QUEUE_BILLING_WEBHOOK,
  QUEUE_MARKETING,
  QUEUE_EMAIL_SEQUENCE,
} from './queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_JOB_IMPORT },
      { name: QUEUE_INVOICE },
      { name: QUEUE_NOTIFICATION },
      { name: QUEUE_CALENDAR_SYNC },
      { name: QUEUE_BILLING_WEBHOOK },
      { name: QUEUE_MARKETING },
      { name: QUEUE_EMAIL_SEQUENCE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
