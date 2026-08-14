import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { QUEUE_NOTIFICATION } from '../queues/queue.constants';
import { UserSettingsService } from '../modules/users/user-settings.service';

@Processor(QUEUE_NOTIFICATION)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly userSettings: UserSettingsService,
  ) {}

  @Process('send-reminder')
  async handleReminder(
    job: Job<{
      userId: string;
      jobId: string;
      type: 'pre_signing' | 'scanback';
      leadMins?: number;
    }>,
  ) {
    const { userId, jobId, type, leadMins = 30 } = job.data;
    const config = await this.userSettings.getNotificationConfig(userId);
    if (
      !config.remindersEnabled ||
      (type === 'pre_signing' && !config.prefs.pre_sign_reminder) ||
      (type === 'scanback' && !config.prefs.scanback_reminder)
    )
      return;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const signingJob = await this.prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!user || !signingJob || signingJob.deleted_at) return;
    if (type === 'pre_signing' && signingJob.status !== 'CONFIRMED') return;
    if (type === 'scanback' && signingJob.status !== 'SCANNING') return;
    if (type === 'pre_signing') {
      const minutesUntil =
        (signingJob.appointment_time.getTime() - Date.now()) / 60_000;
      if (minutesUntil > leadMins || minutesUntil <= leadMins - 10) return;
    }

    await this.notifications.sendPushToUser(userId, {
      title: type === 'pre_signing' ? 'Signing reminder' : 'Scanback reminder',
      body: signingJob.address,
      url: `/jobs/${jobId}`,
      tag: `${type}-${jobId}`,
    });

    if (type === 'pre_signing') {
      await this.notifications.sendEmail({
        to: user.email,
        subject: `Reminder: Signing at ${signingJob.address} in ${leadMins} min`,
        html: `<p>Your signing at <strong>${signingJob.address}</strong> starts at ${signingJob.appointment_time.toLocaleTimeString()}.</p>`,
      });
    }

    await this.prisma.notification.create({
      data: {
        user_id: userId,
        type: 'JOB_REMINDER',
        title:
          type === 'pre_signing' ? 'Signing reminder' : 'Scanback reminder',
        body: `${signingJob.address}`,
        job_id: jobId,
        action_url: `/jobs/${jobId}`,
      },
    });
  }

  @Process('send-client-appointment-reminder')
  async handleClientAppointmentReminder(
    job: Job<{ userId: string; jobId: string }>,
  ) {
    const { userId, jobId } = job.data;
    const config = await this.userSettings.getNotificationConfig(userId);
    if (!config.prefs.client_appointment_reminder) return;
    const signingJob = await this.prisma.job.findUnique({
      where: { id: jobId },
    });
    if (
      !signingJob?.client_email ||
      signingJob.deleted_at ||
      signingJob.status !== 'CONFIRMED'
    )
      return;
    const minutesUntil =
      (signingJob.appointment_time.getTime() - Date.now()) / 60_000;
    if (minutesUntil < 23 * 60 || minutesUntil > 25 * 60) return;

    await this.notifications.sendEmail({
      to: signingJob.client_email,
      subject: 'Your notary appointment is tomorrow',
      html: `<p>Your signing at <strong>${signingJob.address}</strong> is scheduled for ${signingJob.appointment_time.toLocaleString()}.</p>`,
    });
    await this.prisma.notification.create({
      data: {
        user_id: userId,
        type: 'JOB_REMINDER',
        title: 'Client appointment reminder sent',
        body: signingJob.address,
        job_id: jobId,
        action_url: `/jobs/${jobId}`,
      },
    });
  }

  @Process('send-client-eta')
  async handleClientEta(
    job: Job<{ userId: string; nextJobId: string; etaMins: number }>,
  ) {
    const { userId, nextJobId, etaMins } = job.data;
    const config = await this.userSettings.getNotificationConfig(userId);
    if (!config.clientEtaEnabled) return;
    const nextJob = await this.prisma.job.findUnique({
      where: { id: nextJobId },
    });
    if (!nextJob?.client_email) return;

    const etaTime = new Date(Date.now() + etaMins * 60_000);
    await this.notifications.sendEmail({
      to: nextJob.client_email,
      subject: 'Your notary is on the way',
      html: `<p>Your notary is heading to you and will arrive at approximately <strong>${etaTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong>.</p>`,
    });

    this.logger.log(
      `Client ETA sent to ${nextJob.client_email} — ${etaMins} min`,
    );
  }

  @Process('daily-summary')
  async handleDailySummary(job: Job<{ userId: string; date: string }>) {
    const { userId, date } = job.data;
    const config = await this.userSettings.getNotificationConfig(userId);
    if (!config.remindersEnabled) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const day = new Date(date);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const jobs = await this.prisma.job.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        appointment_time: { gte: day, lt: next },
        status: 'COMPLETE',
      },
    });

    const gross = jobs.reduce((s, j) => s + Number(j.fee), 0);
    const net = jobs.reduce((s, j) => s + Number(j.net_earnings ?? j.fee), 0);
    const miles = jobs.reduce((s, j) => s + Number(j.mileage_miles ?? 0), 0);

    await this.notifications.sendEmail({
      to: user.email,
      subject: `Day summary: ${jobs.length} signings · $${net.toFixed(0)} net`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0F2C4E">Your day — ${day.toLocaleDateString()}</h2>
          <p><strong>${jobs.length}</strong> signings completed</p>
          <p>Gross: $${gross.toFixed(2)} · Net: $${net.toFixed(2)} · Miles: ${miles.toFixed(1)}</p>
        </div>
      `,
    });

    await this.prisma.notification.create({
      data: {
        user_id: userId,
        type: 'JOB_REMINDER',
        title: 'Day complete',
        body: `${jobs.length} signings · $${net.toFixed(0)} net · ${miles.toFixed(0)} miles`,
        action_url: '/earnings',
      },
    });
  }
}
