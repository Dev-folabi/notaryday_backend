import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PrismaService } from '../../config/prisma.service';
import webpush from 'web-push';
import { EmailRendererService } from '../../common/email/email-renderer.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend;
  private readonly fromAddress: string;
  private readonly pushEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailRenderer: EmailRendererService,
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
        `RESEND_FROM_ADDRESS is not a valid email address ("${cleaned}"); falling back to "${fallback}"`,
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
    const rendered = this.emailRenderer.render({
      title: `Welcome to Notary Day, ${userName}!`,
      subtitle: 'Getting started with your notary workspace',
      greeting: `Hi ${userName},`,
      intro:
        'Notary Day helps mobile notaries manage scheduling, jobs, profitability, and client communication in one place.',
      contentHtml:
        '<ol style="margin:0;padding-left:20px;color:#475569;font-size:13px;line-height:1.8"><li>Complete onboarding with your home base and signing types.</li><li>Try Can I Take This? for your next job inquiry.</li><li>Explore your day view and job schedule.</li></ol><div style="margin-top:18px;padding:12px 14px;border-radius:8px;background:#FFFBEB;border:1px solid #FDE68A;color:#475569;font-size:12px;line-height:1.6"><strong style="color:#0F2C4E">Pro tip:</strong> Use CITT before committing to a job to check schedule fit and profitability.</div>',
      footer:
        'You are receiving this email because you signed up for Notary Day.',
      plainText: `Welcome to Notary Day, ${userName}. Complete onboarding, try CITT, and explore your schedule.`,
    });

    return this.sendEmail({
      to: userEmail,
      subject: 'Welcome to Notary Day!',
      html: rendered.html,
      text: rendered.text,
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
    const rendered = this.emailRenderer.render({
      title: 'Reset your Notary Day password',
      subtitle: 'Password reset request',
      intro:
        'We received a request to reset your Notary Day password. This link expires in one hour.',
      contentHtml:
        '<p style="font-size:13px;line-height:1.7;color:#475569">If you did not request this, you can safely ignore this email.</p>',
      action: { label: 'Reset password', url: resetUrl },
      footer:
        'You are receiving this email because you have an account with Notary Day.',
      plainText: `Reset your Notary Day password using this link: ${resetUrl}. The link expires in one hour.`,
    });

    return this.sendEmail({
      to: userEmail,
      subject: 'Reset your Notary Day password',
      html: rendered.html,
      text: rendered.text,
    });
  }

  /**
   * Send notification email (used by notification processor)
   */
  async sendNotificationEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
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
