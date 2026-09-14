import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../config/prisma.module';
import { EmailRendererService } from '../../common/email/email-renderer.service';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { QueueModule } from '../../queues/queue.module';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule, TransactionalEmailModule, QueueModule],
  providers: [NotificationsService, EmailRendererService],
  controllers: [NotificationsController],
  exports: [NotificationsService, EmailRendererService],
})
export class NotificationsModule {}
