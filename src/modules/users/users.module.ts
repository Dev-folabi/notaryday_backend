import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserSettingsService } from './user-settings.service';
import { UsersController } from './users.controller';

@Module({
  imports: [],
  providers: [UsersService, UserSettingsService],
  controllers: [UsersController],
  exports: [UsersService, UserSettingsService],
})
export class UsersModule {}
