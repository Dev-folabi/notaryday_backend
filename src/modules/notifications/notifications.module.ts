import { Module, Global } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../config/prisma.module';
import { EmailRendererService } from '../../common/email/email-renderer.service';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [NotificationsService, EmailRendererService],
  controllers: [NotificationsController],
  exports: [NotificationsService, EmailRendererService],
})
export class NotificationsModule {}
