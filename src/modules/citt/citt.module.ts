import { Module } from '@nestjs/common';
import { CittService } from './citt.service';
import { CittController } from './citt.controller';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { UsersModule } from '../users/users.module';
import { JobsModule } from '../jobs/jobs.module';
import { MarketingEventsModule } from '../marketing/events/marketing-events.module';

@Module({
  imports: [GeocodingModule, UsersModule, JobsModule, MarketingEventsModule],
  controllers: [CittController],
  providers: [CittService],
})
export class CittModule {}
