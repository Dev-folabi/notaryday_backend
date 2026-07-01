import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EmailImportController } from './email-import.controller';
import { EmailImportService } from './email-import.service';
import { QUEUE_EMAIL_IMPORT } from '../../queues/queue.constants';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_EMAIL_IMPORT }),
    UsersModule,
  ],
  controllers: [EmailImportController],
  providers: [EmailImportService],
  exports: [EmailImportService],
})
export class EmailImportModule {}
