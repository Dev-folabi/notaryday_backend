import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_MARKETING } from '../../../queues/queue.constants';
import { MarketingEventsEmitter } from './marketing-events.emitter';

/**
 * Lightweight module for emitting marketing events (lead conversions) from
 * other API modules. No Mongo — safe to import anywhere.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_MARKETING })],
  providers: [MarketingEventsEmitter],
  exports: [MarketingEventsEmitter],
})
export class MarketingEventsModule {}
