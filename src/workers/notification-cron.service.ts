import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_NOTIFICATION } from '../queues/queue.constants';
import { JobStatus, PlanTier } from '../../generated/prisma';
import { UserSettingsService } from '../modules/users/user-settings.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { EmailRendererService } from '../common/email/email-renderer.service';

@Injectable()
export class NotificationCronService {
  private readonly logger = new Logger(NotificationCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userSettings: UserSettingsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly emailRenderer: EmailRendererService,
    @InjectQueue(QUEUE_NOTIFICATION) private readonly notifQueue: Queue,
  ) {}

  /** Every 5 minutes: dispatch reminders using each user's configured lead. */
  @Cron('*/5 * * * *')
  async dispatchPreSigningReminders() {
    const now = new Date();
    const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

    const jobs = await this.prisma.job.findMany({
      where: {
        deleted_at: null,
        status: JobStatus.CONFIRMED,
        appointment_time: { gt: now, lte: inSevenDays },
      },
    });

    for (const job of jobs) {
      const config = await this.userSettings.getNotificationConfig(job.user_id);
      if (!config.remindersEnabled || !config.prefs.pre_sign_reminder) continue;

      const minutesUntil =
        (job.appointment_time.getTime() - now.getTime()) / 60_000;
      if (
        minutesUntil > config.reminderLeadMins ||
        minutesUntil <= config.reminderLeadMins - 5
      )
        continue;

      // Check if reminder already sent (avoid duplicates)
      const existing = await this.prisma.notification.findFirst({
        where: {
          user_id: job.user_id,
          job_id: job.id,
          type: 'JOB_REMINDER',
          title: 'Signing reminder',
        },
      });
      if (existing) continue;

      try {
        await this.notifQueue.add(
          'send-reminder',
          {
            userId: job.user_id,
            jobId: job.id,
            type: 'pre_signing',
            leadMins: config.reminderLeadMins,
          },
          { jobId: `pre-signing-${job.id}-${job.appointment_time.getTime()}` },
        );
      } catch (err) {
        this.logger.error(
          `Failed to enqueue reminder for job ${job.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (jobs.length > 0)
      this.logger.log(`Checked ${jobs.length} jobs for pre-signing reminders`);
  }

  /** Every 5 minutes: email clients whose signing starts in 24 hours. */
  @Cron('*/5 * * * *')
  async dispatchClientAppointmentReminders() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60_000);
    const in24h5 = new Date(in24h.getTime() + 5 * 60_000);
    const jobs = await this.prisma.job.findMany({
      where: {
        deleted_at: null,
        status: JobStatus.CONFIRMED,
        client_email: { not: null },
        appointment_time: { gte: in24h, lt: in24h5 },
      },
    });

    for (const job of jobs) {
      const config = await this.userSettings.getNotificationConfig(job.user_id);
      if (!config.prefs.client_appointment_reminder) continue;
      const existing = await this.prisma.notification.findFirst({
        where: {
          user_id: job.user_id,
          job_id: job.id,
          type: 'JOB_REMINDER',
          title: 'Client appointment reminder sent',
        },
      });
      if (existing) continue;

      await this.notifQueue.add(
        'send-client-appointment-reminder',
        { userId: job.user_id, jobId: job.id },
        {
          jobId: `client-appointment-${job.id}-${job.appointment_time.getTime()}`,
        },
      );
    }
  }

  /** Every day at 9 PM: send daily summary to users who had jobs today */
  @Cron('0 21 * * *')
  async dispatchDailySummaries() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const usersWithJobs = await this.prisma.job.findMany({
      where: {
        deleted_at: null,
        status: JobStatus.COMPLETE,
        appointment_time: { gte: today, lt: tomorrow },
      },
      select: { user_id: true },
      distinct: ['user_id'],
    });

    for (const { user_id } of usersWithJobs) {
      const config = await this.userSettings.getNotificationConfig(user_id);
      if (!config.remindersEnabled) continue;
      try {
        await this.notifQueue.add('daily-summary', {
          userId: user_id,
          date: today.toISOString().slice(0, 10),
        });
      } catch (err) {
        this.logger.error(
          `Failed to enqueue daily summary for user ${user_id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (usersWithJobs.length > 0)
      this.logger.log(`Dispatched ${usersWithJobs.length} daily summaries`);
  }

  /** Daily: always notify paid-plan users three days before expiry. */
  @Cron('0 9 * * *')
  async dispatchPlanExpiryEmails() {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
    const inFourDays = new Date(now.getTime() + 4 * 24 * 60 * 60_000);
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        plan: { not: PlanTier.FREE },
        plan_expires_at: { gte: inThreeDays, lt: inFourDays },
      },
    });

    for (const user of users) {
      const apiKey = this.config.get<string>('LEMONSQUEEZY_API_KEY');
      if (!apiKey || !user.lemon_squeezy_subscription_id) continue;
      const response = await fetch(
        `https://api.lemonsqueezy.com/v1/subscriptions/${user.lemon_squeezy_subscription_id}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/vnd.api+json',
          },
        },
      ).catch(() => null);
      if (!response?.ok) continue;
      const subscription = (await response.json()) as {
        data?: { attributes?: { cancelled?: boolean } };
      };
      if (!subscription.data?.attributes?.cancelled) continue;

      await this.notifications.sendPushToUser(user.id, {
        title: 'Your Notary Day plan expires in 3 days',
        body: 'Visit billing settings to keep your Pro features active.',
        url: '/settings?tab=billing',
        tag: `plan-expiring-${user.id}`,
      });
      const rendered = this.emailRenderer.render({
        title: 'Your plan expires in 3 days',
        subtitle: 'Notary Day · Billing update',
        greeting: `Hi ${user.full_name ?? user.username},`,
        intro: `Your plan expires on <strong style="color:#0F2C4E">${user.plan_expires_at?.toLocaleDateString()}</strong>.`,
        contentHtml:
          '<p style="font-size:13px;line-height:1.7;color:#475569">Visit billing settings to keep your Pro features active.</p>',
        action: {
          label: 'Open billing settings',
          url: '/settings?tab=billing',
        },
        plainText: `Your plan expires on ${user.plan_expires_at?.toLocaleDateString()}. Open billing settings to keep your Pro features active.`,
      });
      await this.notifications
        .sendEmail({
          to: user.email,
          subject: 'Your Notary Day plan expires in 3 days',
          html: rendered.html,
          text: rendered.text,
        })
        .catch((err) =>
          this.logger.error(
            `Failed to send plan expiry email to ${user.id}`,
            err instanceof Error ? err.stack : String(err),
          ),
        );
    }
  }

  /** Daily: end expired Pro trials. Trial users have no Lemon Squeezy
   *  subscription, so they are never touched by webhook lifecycles. */
  @Cron('0 6 * * *')
  async expireTrials() {
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        plan: { in: [PlanTier.PRO, PlanTier.PRO_ANNUAL] },
        plan_expires_at: { lt: now },
        lemon_squeezy_subscription_id: null,
      },
    });

    if (users.length === 0) return;

    for (const user of users) {
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { plan: PlanTier.FREE, plan_expires_at: null },
        });
        this.logger.log(`Trial ended for user ${user.id}, downgraded to FREE`);
      } catch (err) {
        this.logger.error(
          `Failed to end trial for user ${user.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  /** Daily: remind trial users three days before their Pro trial ends. */
  @Cron('0 9 * * *')
  async dispatchTrialEndingEmails() {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
    const inFourDays = new Date(now.getTime() + 4 * 24 * 60 * 60_000);
    const users = await this.prisma.user.findMany({
      where: {
        deleted_at: null,
        plan: { not: PlanTier.FREE },
        plan_expires_at: { gte: inThreeDays, lt: inFourDays },
        lemon_squeezy_subscription_id: null,
      },
    });

    for (const user of users) {
      try {
        await this.notifications.sendPushToUser(user.id, {
          title: 'Your Pro trial ends in 3 days',
          body: 'Your free Pro access expires soon. Upgrade to keep the features.',
          url: '/settings?tab=billing',
          tag: `trial-ending-${user.id}`,
        });
        const rendered = this.emailRenderer.render({
          title: 'Your Pro trial ends in 3 days',
          subtitle: 'Notary Day · Billing update',
          greeting: `Hi ${user.full_name ?? user.username},`,
          intro: `Your free Pro trial ends on <strong style="color:#0F2C4E">${user.plan_expires_at?.toLocaleDateString()}</strong>.`,
          contentHtml:
            '<p style="font-size:13px;line-height:1.7;color:#475569">After that, your account moves to Free and Pro features like route optimisation, the booking page, email import and auto invoicing are locked. Your data stays safe either way.</p>',
          action: {
            label: 'Keep Pro',
            url: '/settings?tab=billing',
          },
          plainText: `Your free Pro trial ends on ${user.plan_expires_at?.toLocaleDateString()}. After that, your account moves to Free. Your data stays safe either way.`,
        });
        await this.notifications.sendEmail({
          to: user.email,
          subject: 'Your Notary Day Pro trial ends in 3 days',
          html: rendered.html,
          text: rendered.text,
        });
      } catch (err) {
        this.logger.error(
          `Failed to send trial ending email to ${user.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
