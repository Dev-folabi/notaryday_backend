import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import {
  QUEUE_JOB_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
} from './queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_JOB_IMPORT },
      { name: QUEUE_INVOICE },
      { name: QUEUE_NOTIFICATION },
      { name: QUEUE_CALENDAR_SYNC },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
