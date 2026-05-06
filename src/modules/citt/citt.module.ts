import { Module } from '@nestjs/common';
import { CittService } from './citt.service';
import { CittController } from './citt.controller';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { UsersModule } from '../users/users.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [GeocodingModule, UsersModule, JobsModule],
  controllers: [CittController],
  providers: [CittService],
})
export class CittModule {}
