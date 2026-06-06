import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { UsersModule } from '../users/users.module';
import { QUEUE_INVOICE } from '../../queues/queue.constants';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_INVOICE }), UsersModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
