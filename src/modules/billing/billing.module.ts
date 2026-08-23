import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing.webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../config/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BullModule } from '@nestjs/bull';
import { QUEUE_BILLING_WEBHOOK } from '../../queues/queue.constants';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    UsersModule,
    NotificationsModule,
    BullModule.registerQueue({ name: QUEUE_BILLING_WEBHOOK }),
  ],
  providers: [BillingService],
  controllers: [BillingController, BillingWebhookController],
  exports: [BillingService],
})
export class BillingModule {}
