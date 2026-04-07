import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import {
  QUEUE_EMAIL_IMPORT,
  QUEUE_SCREENSHOT_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
} from './queue.constants';

@Module({
  imports: [
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