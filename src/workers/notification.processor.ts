import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { QUEUE_NOTIFICATION } from '../queues/queue.constants';

@Processor(QUEUE_NOTIFICATION)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Process('send-reminder')
  async handleReminder(
    job: Job<{
      userId: string;
      jobId: string;
      type: 'pre_signing' | 'scanback';
    }>,
  ) {
    const { userId, jobId, type } = job.data;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const signingJob = await this.prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!user || !signingJob) return;

    if (type === 'pre_signing') {
      await this.notifications.sendEmail({
        to: user.email,
        subject: `Reminder: Signing at ${signingJob.address} in 30 min`,
        html: `<p>Your signing at <strong>${signingJob.address}</strong> starts at ${signingJob.appointment_time.toLocaleTimeString()}.</p>`,
      });
    }

    await this.prisma.notification.create({
      data: {
        user_id: userId,
        type: 'JOB_REMINDER',
        title:
          type === 'pre_signing'
            ? 'Signing in 30 minutes'
            : 'Scanback reminder',
        body: `${signingJob.address}`,
        job_id: jobId,
        action_url: `/jobs/${jobId}`,
      },
    });
  }

  @Process('send-client-eta')
  async handleClientEta(
    job: Job<{ userId: string; nextJobId: string; etaMins: number }>,
  ) {
    const { nextJobId, etaMins } = job.data;
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
