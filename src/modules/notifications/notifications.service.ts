import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../config/prisma.service';
import webpush from 'web-push';
import { EmailRendererService } from '../../common/email/email-renderer.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
import {
  getExistingUserEmailSequence,
  getNewUserEmailSequence,
  getFirstName,
  getDelayMsToUsET10am,
} from './email-sequences';
import { QUEUE_EMAIL_SEQUENCE } from '../../queues/queue.constants';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly pushEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly emailRenderer: EmailRendererService,
    private readonly transactionalEmail: TransactionalEmailService,
    @InjectQueue(QUEUE_EMAIL_SEQUENCE)
    private readonly emailSequenceQueue: Queue,
  ) {
    const publicKey = this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('WEB_PUSH_SUBJECT');
    this.pushEnabled = Boolean(publicKey && privateKey && subject);
    if (this.pushEnabled) {
      webpush.setVapidDetails(subject!, publicKey!, privateKey!);
    }
  }

  /**
   * Send a transactional email via the active provider (Resend or Brevo),
   * with automatic fallback to the other provider on failure.
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    return this.transactionalEmail.send(options);
  }

  /**
   * Send welcome/onboarding email to new user (Day 0)
   */
  async sendWelcomeEmail(
    userEmail: string,
    userName: string,
    trialDays?: number,
  ) {
    const firstName = getFirstName(userName);
    const email = getNewUserEmailSequence(firstName, trialDays)[0];

    const rendered = this.emailRenderer.render({
      title: email.title,
      subtitle: email.subtitle,
      greeting: email.greeting,
      intro: email.intro,
      contentHtml: email.contentHtml,
      footer: email.footer,
      plainText: email.plainText,
    });

    return this.sendEmail({
      to: userEmail,
      subject: email.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
  /**
   * Send the full 5-day onboarding sequence for a new user.
   * Day 0 is sent immediately. Days 1-4 are scheduled via BullMQ (production only).
   * Staging/Dev: Day 0 only, no scheduling.
   */
  async sendNewUserOnboardingSequence(
    userEmail: string,
    userName: string,
    trialDays?: number,
  ) {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    const firstName = getFirstName(userName);
    const sequence = getNewUserEmailSequence(firstName, trialDays);
    const day0 = sequence[0];

    await this.ensureEmailSequenceRecord(userEmail, 'new_user', true);

    const rendered = this.emailRenderer.render({
      title: day0.title,
      subtitle: day0.subtitle,
      greeting: day0.greeting,
      intro: day0.intro,
      contentHtml: day0.contentHtml,
      footer: day0.footer,
      plainText: day0.plainText,
    });

    let sent = 0;
    try {
      await this.sendEmail({
        to: userEmail,
        subject: day0.subject,
        html: rendered.html,
        text: rendered.text,
      });
      sent = 1;
      await this.markDaySent(userEmail, 0);
    } catch (error) {
      this.logger.warn(
        `Failed to send onboarding email day 0 to ${userEmail}:`,
        error,
      );
    }

    if (isProduction) {
      await this.scheduleSequenceDays(userEmail, 'new_user', 1, 5);
    }

    return { sent };
  }

  /**
   * Send the full 5-day onboarding sequence for an existing user.
   * Production only — no emails sent on staging/dev.
   * Day 0 is sent immediately. Days 1-4 are scheduled via BullMQ.
   */
  async sendExistingUserSequence(
    userEmail: string,
    userName: string,
    trialDays?: number,
  ) {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';

    if (!isProduction) {
      this.logger.debug(
        `Skipping existing user email sequence for ${userEmail}: not in production`,
      );
      return { sent: 0 };
    }

    await this.ensureEmailSequenceRecord(userEmail, 'existing_user', true);

    const firstName = getFirstName(userName);
    const sequence = getExistingUserEmailSequence(firstName, trialDays);
    const day0 = sequence[0];

    const rendered = this.emailRenderer.render({
      title: day0.title,
      subtitle: day0.subtitle,
      greeting: day0.greeting,
      intro: day0.intro,
      contentHtml: day0.contentHtml,
      footer: day0.footer,
      plainText: day0.plainText,
    });

    let sent = 0;
    try {
      await this.sendEmail({
        to: userEmail,
        subject: day0.subject,
        html: rendered.html,
        text: rendered.text,
      });
      sent = 1;
    } catch (error) {
      this.logger.warn(
        `Failed to send existing user onboarding email day 0 to ${userEmail}:`,
        error,
      );
    }

    await this.scheduleSequenceDays(userEmail, 'existing_user', 1, 5);

    return { sent };
  }

  private async ensureEmailSequenceRecord(
    userEmail: string,
    sequenceType: 'new_user' | 'existing_user',
    create: boolean,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!user) return;

    if (create) {
      await this.prisma.emailSequence.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          sequenceType,
        },
        update: {
          sequenceType,
          currentDay: 0,
        },
      });
    }
  }

  private async markDaySent(userEmail: string, day: number): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!user) return;

    await this.prisma.emailSequence.update({
      where: { userId: user.id },
      data: {
        [`day${day}SentAt`]: new Date(),
        currentDay: day + 1,
      },
    });
  }

  private async scheduleSequenceDays(
    userEmail: string,
    sequenceType: 'new_user' | 'existing_user',
    fromDay: number,
    toDay: number,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true, full_name: true, plan_expires_at: true },
    });
    if (!user) return;

    for (let day = fromDay; day < toDay; day++) {
      const delay = getDelayMsToUsET10am(day);
      await this.emailSequenceQueue.add(
        'send-email',
        {
          userId: user.id,
          sequenceType,
          day,
        },
        {
          jobId: `email-seq-${sequenceType}-${user.id}-day${day}`,
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      this.logger.log(
        `Scheduled email sequence day ${day} for ${userEmail} (${sequenceType}), delay: ${delay}ms`,
      );
    }
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
      | 'WELCOME'
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

  /**
   * Find existing users who have no emailSequence record and start their
   * onboarding sequence. Capped at `limit` users per call to avoid flooding.
   * Returns the number of sequences started.
   */
  async backfillExistingUserSequences(limit = 50): Promise<number> {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    if (!isProduction) return 0;

    const users = await this.prisma.$queryRaw<
      {
        id: string;
        email: string;
        full_name: string | null;
        plan_expires_at: Date | null;
      }[]
    >`
      SELECT u.id, u.email, u.full_name, u.plan_expires_at
      FROM "users" u
      LEFT JOIN "email_sequences" es ON u.id = es."userId"
      WHERE es."id" IS NULL
        AND u."deleted_at" IS NULL
        AND u."created_at" < NOW() - INTERVAL '1 day'
      ORDER BY u."created_at" ASC
      LIMIT ${limit}
    `;

    if (users.length === 0) return 0;

    this.logger.log(
      `Backfill: starting email sequences for ${users.length} existing users`,
    );

    let started = 0;
    for (const user of users) {
      try {
        const trialDays = user.plan_expires_at
          ? Math.max(
              1,
              Math.ceil(
                (user.plan_expires_at.getTime() - Date.now()) /
                  (24 * 60 * 60 * 1000),
              ),
            )
          : undefined;
        await this.sendExistingUserSequence(
          user.email,
          user.full_name || 'Notary',
          trialDays,
        );
        started++;
      } catch (error) {
        this.logger.warn(
          `Backfill: failed to start sequence for ${user.email}:`,
          error,
        );
      }
    }

    return started;
  }
}
