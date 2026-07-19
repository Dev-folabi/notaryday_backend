import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { UsersModule } from '../users/users.module';
import { BullModule } from '@nestjs/bull';
import {
  QUEUE_CALENDAR_SYNC,
  QUEUE_NOTIFICATION,
} from '../../queues/queue.constants';

@Module({
  imports: [
    GeocodingModule,
    UsersModule,
    BullModule.registerQueue({
      name: QUEUE_CALENDAR_SYNC,
    }),
    BullModule.registerQueue({ name: QUEUE_NOTIFICATION }),
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
