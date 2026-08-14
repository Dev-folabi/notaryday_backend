import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  UseGuards,
  Request,
  Delete,
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
import {
  PushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dto/push-subscription.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('push/public-key')
  @ApiOperation({ summary: 'Get the Web Push VAPID public key' })
  getPushPublicKey() {
    return { publicKey: this.notificationsService.getPushPublicKey() };
  }

  @Post('push/subscriptions')
  @ApiOperation({ summary: 'Register a browser push subscription' })
  async savePushSubscription(
    @Body() dto: PushSubscriptionDto,
    @Request() req: RequestWithUser,
  ) {
    return this.notificationsService.savePushSubscription(req.user.id, dto);
  }

  @Delete('push/subscriptions')
  @ApiOperation({ summary: 'Remove a browser push subscription' })
  async removePushSubscription(
    @Body() dto: RemovePushSubscriptionDto,
    @Request() req: RequestWithUser,
  ) {
    return this.notificationsService.removePushSubscription(
      req.user.id,
      dto.endpoint,
    );
  }

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

  @Get()
  @ApiOperation({ summary: 'Get all notifications for the current user' })
  @ApiResponse({ status: 200, description: 'Array of notifications' })
  async getNotifications(@Request() req: RequestWithUser) {
    return await this.notificationsService.getNotifications(req.user.id);
  }

  @Get('list')
  @ApiOperation({
    summary: 'Get all notifications for the current user (alias)',
  })
  @ApiResponse({ status: 200, description: 'Array of notifications' })
  async getNotificationsAlias(@Request() req: RequestWithUser) {
    return await this.notificationsService.getNotifications(req.user.id);
  }

  @Patch(':id/read')
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

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read (alias)' })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsReadAlias(@Request() req: RequestWithUser) {
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
