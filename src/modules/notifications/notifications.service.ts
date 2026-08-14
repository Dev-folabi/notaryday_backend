import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PrismaService } from '../../config/prisma.service';
import webpush from 'web-push';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend;
  private readonly fromAddress: string;
  private readonly pushEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    this.resend = new Resend(apiKey);
    this.fromAddress = this.normalizeFromAddress(
      this.config.get<string>('RESEND_FROM_ADDRESS'),
    );

    const publicKey = this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('WEB_PUSH_SUBJECT');
    this.pushEnabled = Boolean(publicKey && privateKey && subject);
    if (this.pushEnabled) {
      webpush.setVapidDetails(subject!, publicKey!, privateKey!);
    }
  }

  private normalizeFromAddress(value: string | undefined): string {
    const fallback = 'Notary Day <noreply@notaryday.app>';
    const cleaned = (value ?? '')
      .trim()
      .replace(/^['"]+|['"]+$/g, '')
      .trim();
    if (!cleaned) return fallback;

    const match = cleaned.match(/^([^<>]*?)\s*<([^<>]+)>$/);
    const email = (match ? match[2] : cleaned).trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

    if (!emailValid) {
      this.logger.warn(
        `RESEND_FROM_ADDRESS is not a valid email address ("${cleaned}") — falling back to "${fallback}"`,
      );
      return fallback;
    }
    return match ? `${match[1].trim()} <${email}>` : email;
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

  /**
   * Create an in-app notification record for a user
   */
  async createNotification(data: {
    userId: string;
    type:
      | 'BOOKING_RECEIVED'
      | 'BOOKING_CONFIRMED'
      | 'BOOKING_DECLINED'
      | 'JOB_REMINDER'
      | 'CLIENT_ETA'
      | 'INVOICE_SENT'
      | 'PAYMENT_RECEIVED'
      | 'PLAN_UPGRADED'
      | 'PLAN_CANCELLED';
    title: string;
    body: string;
    jobId?: string;
    bookingId?: string;
    actionUrl?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        user_id: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        job_id: data.jobId,
        booking_id: data.bookingId,
        action_url: data.actionUrl,
      },
    });
  }

  getPushPublicKey(): string | null {
    return this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY') || null;
  }

  async savePushSubscription(
    userId: string,
    data: {
      endpoint: string;
      p256dh: string;
      auth: string;
      user_agent?: string;
    },
  ) {
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: data.endpoint },
    });
    if (existing && existing.user_id !== userId) {
      await this.prisma.pushSubscription.delete({ where: { id: existing.id } });
    }
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      create: { user_id: userId, ...data },
      update: { ...data, last_used_at: new Date() },
    });
  }

  async removePushSubscription(userId: string, endpoint: string) {
    return this.prisma.pushSubscription.deleteMany({
      where: { user_id: userId, endpoint },
    });
  }

  async sendPushToUser(
    userId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
  ) {
    if (!this.pushEnabled) return;

    try {
      const settings = await this.prisma.userSettings.findUnique({
        where: { user_id: userId },
        select: { notification_prefs: true },
      });
      const prefs = settings?.notification_prefs;
      if (
        prefs &&
        typeof prefs === 'object' &&
        !Array.isArray(prefs) &&
        (prefs as Record<string, unknown>).push_enabled === false
      )
        return;

      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: { user_id: userId },
      });
      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify(payload),
            );
            await this.prisma.pushSubscription.update({
              where: { id: subscription.id },
              data: { last_used_at: new Date() },
            });
          } catch (error) {
            const statusCode = (error as { statusCode?: number }).statusCode;
            if (statusCode === 404 || statusCode === 410) {
              await this.prisma.pushSubscription.delete({
                where: { id: subscription.id },
              });
              return;
            }
            this.logger.warn(
              `Push delivery failed for subscription ${subscription.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Push dispatch skipped for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
