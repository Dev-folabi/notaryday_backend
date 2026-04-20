import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing.webhook.controller';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from 'src/config/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule, UsersModule],
  providers: [BillingService],
  controllers: [BillingController, BillingWebhookController],
  exports: [BillingService],
})
export class BillingModule {}
