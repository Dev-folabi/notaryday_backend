import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('send')
  async sendNotification(
    @Body() dto: SendNotificationDto,
    @Request() req: RequestWithUser,
  ) {
    // Only allow sending to the authenticated user's email for security
    const userEmail = req.user.email;
    if (dto.to.toLowerCase() !== userEmail.toLowerCase()) {
      throw new Error(
        'Unauthorized: Can only send notifications to your own email',
      );
    }

    return this.notificationsService.sendNotificationEmail({
      to: dto.to,
      subject: dto.subject,
      html: dto.html,
    });
  }

  @Post('test-welcome')
  async sendTestWelcome(@Request() req: RequestWithUser) {
    // Development/test endpoint to send welcome email to current user
    return this.notificationsService.sendWelcomeEmail(
      req.user.email,
      req.user.full_name || 'Test User',
    );
  }

  @Get('list')
  async getNotifications(@Request() req: RequestWithUser) {
    return await this.notificationsService.getNotifications(req.user.id);
  }

  @Post(':id/read')
  async markAsRead(@Request() req: RequestWithUser) {
    const notificationId = req.params.id;
    if (!notificationId) {
      throw new Error('Notification ID is required');
    }
    return await this.notificationsService.markAsRead(
      notificationId,
      req.user.id,
    );
  }
}
