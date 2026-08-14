import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing.webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from 'src/config/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule, NotificationsModule],
  providers: [BillingService],
  controllers: [BillingController, BillingWebhookController],
  exports: [BillingService],
})
export class BillingModule {}
