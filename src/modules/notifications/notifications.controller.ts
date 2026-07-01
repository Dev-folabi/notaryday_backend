import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send a notification email to yourself' })
  @ApiResponse({ status: 201, description: 'Notification sent' })
  @ApiResponse({ status: 403, description: 'Can only send to your own email' })
  async sendNotification(
    @Body() dto: SendNotificationDto,
    @Request() req: RequestWithUser,
  ) {
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
  @ApiOperation({
    summary: 'Send a test welcome email to current user (dev/test)',
  })
  @ApiResponse({ status: 201, description: 'Welcome email sent' })
  async sendTestWelcome(@Request() req: RequestWithUser) {
    return this.notificationsService.sendWelcomeEmail(
      req.user.email,
      req.user.full_name || 'Test User',
    );
  }

  @Get('list')
  @ApiOperation({ summary: 'Get all notifications for the current user' })
  @ApiResponse({ status: 200, description: 'Array of notifications' })
  async getNotifications(@Request() req: RequestWithUser) {
    return await this.notificationsService.getNotifications(req.user.id);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
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
