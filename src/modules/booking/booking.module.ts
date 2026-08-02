import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { UsersModule } from '../users/users.module';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
  imports: [UsersModule, GeocodingModule, EmailTemplatesModule],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
