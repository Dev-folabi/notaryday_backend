import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [GeocodingModule, UsersModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
