import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend;
  private readonly fromAddress: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    this.resend = new Resend(apiKey);
    this.fromAddress =
      this.config.get<string>('RESEND_FROM_ADDRESS') ||
      'Notary Day <noreply@notaryday.app>';
  }

  /**
   * Send a raw email via Resend
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      if (error) {
        this.logger.error(`Failed to send email: ${error.message}`);
        throw new Error(`Failed to send email: ${error.message}`);
      }

      this.logger.log(`Email sent successfully to ${options.to}`);
      return data;
    } catch (error) {
      this.logger.error(`Error sending email: ${error}`);
      throw error;
    }
  }

  /**
   * Send welcome/onboarding email to new user
   */
  async sendWelcomeEmail(userEmail: string, userName: string) {
    const subject = 'Welcome to Notary Day!';
    const html = `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0F2C4E;">Welcome to Notary Day, ${userName}!</h1>
        <p>Thank you for signing up for Notary Day - the smart scheduling and business management tool built specifically for mobile notaries and loan signing agents.</p>

        <h2 style="color: #0F2C4E;">Getting Started:</h2>
        <ol>
          <li>Complete your onboarding (home base, mileage rate, signing types)</li>
          <li>Try our free "Can I Take This?" feature to check job feasibility</li>
          <li>Explore the dashboard to see your day at a glance</li>
        </ol>

        <p style="background-color: #FEF3C7; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <strong>Pro Tip:</strong> The floating "Can I Take This?" button is available on every screen - tap it anytime you get a job inquiry to instantly check if it fits your schedule and is profitable!
        </p>

        <p>If you have any questions, don't hesitate to reach out. We're here to help you succeed!</p>

        <p>Best regards,<br>The Notary Day Team</p>

        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0;">
        <p style="font-size: 12px; color: #64748B;">
          You're receiving this email because you signed up for Notary Day at notaryday.app
        </p>
      </div>
    `;

    return this.sendEmail({
      to: userEmail,
      subject,
      html,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    userEmail: string,
    resetToken: string,
    appUrl: string,
  ) {
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;
    const subject = 'Reset your Notary Day password';
    const html = `
      <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0F2C4E;">Reset your Notary Day password</h1>
        <p>We received a request to reset your password for your Notary Day account.</p>

        <p>Click the button below to reset your password. This link will expire in 1 hour for security reasons:</p>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${resetUrl}" style="background-color: #0F2C4E; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
            Reset Password
          </a>
        </div>

        <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>

        <p>Best regards,<br>The Notary Day Team</p>

        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 24px 0;">
        <p style="font-size: 12px; color: #64748B;">
          You're receiving this email because you have an account with Notary Day at notaryday.app
        </p>
      </div>
    `;

    return this.sendEmail({
      to: userEmail,
      subject,
      html,
    });
  }

  /**
   * Send notification email (used by notification processor)
   */
  async sendNotificationEmail(options: {
    to: string;
    subject: string;
    html: string;
  }) {
    return this.sendEmail(options);
  }

  /**
   * Get user notifications
   */
  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.update({
      where: { id, user_id: userId },
      data: { is_read: true },
    });
  }
}
