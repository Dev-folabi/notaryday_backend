import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JobImportController } from './job-import.controller';
import { JobImportService } from './job-import.service';
import { QUEUE_JOB_IMPORT } from '../../queues/queue.constants';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_JOB_IMPORT }), UsersModule],
  controllers: [JobImportController],
  providers: [JobImportService],
  exports: [JobImportService],
})
export class JobImportModule {}
