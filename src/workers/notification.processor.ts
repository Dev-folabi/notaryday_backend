import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { QUEUE_NOTIFICATION } from '../queues/queue.constants';
import { UserSettingsService } from '../modules/users/user-settings.service';
import { EmailRendererService } from '../common/email/email-renderer.service';
import { EmailTemplatesService } from '../modules/email-templates/email-templates.service';

function fmtInTz(
  date: Date,
  timezone?: string | null,
  opts: { dateOnly?: boolean } = {},
): string {
  try {
    const abbr = timezone
      ? (new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          timeZoneName: 'short',
        })
          .formatToParts(date)
          .find((p) => p.type === 'timeZoneName')?.value ?? null)
      : null;
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone ?? undefined,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      ...(opts.dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
    }).format(date);
    return abbr && !opts.dateOnly ? `${formatted} (${abbr})` : formatted;
  } catch {
    return date.toLocaleString();
  }
}

@Processor(QUEUE_NOTIFICATION)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly userSettings: UserSettingsService,
    private readonly emailRenderer: EmailRendererService,
    private readonly emailTemplates: EmailTemplatesService,
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
      const rendered = this.emailRenderer.render({
        title: 'Signing reminder',
        subtitle: 'Your upcoming appointment',
        greeting: `Hi ${user.full_name ?? 'there'},`,
        intro: `Your signing appointment starts in <strong style="color:#0F2C4E">${leadMins} minutes</strong>.`,
        contentHtml: this.emailRenderer.detailBlock([
          ['Notary', user.full_name ?? 'Notary Day'],
          ['Date', signingJob.appointment_time.toLocaleDateString()],
          ['Time', signingJob.appointment_time.toLocaleTimeString()],
          ['Address', signingJob.address],
          ['Service', signingJob.signing_type.replace('_', ' ')],
        ]),
        footer:
          'Please have all documents ready and ensure the signers are present with valid photo ID.',
        plainText: `Your signing at ${signingJob.address} starts in ${leadMins} minutes.`,
      });
      await this.notifications.sendEmail({
        to: user.email,
        subject: `Reminder: Signing at ${signingJob.address} in ${leadMins} min`,
        html: rendered.html,
        text: rendered.text,
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const timezone = (await this.userSettings.get(userId)).timezone ?? null;
    const template = await this.emailTemplates.findByType(
      userId,
      'appointment_reminder',
    );
    const custom =
      template && template.is_active
        ? this.emailTemplates.render(template, {
            client_name: signingJob.client_name ?? 'there',
            notary_name: user.full_name ?? user.username,
            appointment_time: fmtInTz(signingJob.appointment_time, timezone),
            address: signingJob.address,
            service_type: signingJob.signing_type.replace('_', ' '),
          })
        : null;

    const rendered = this.emailRenderer.render({
      title: 'Appointment reminder',
      subtitle: `Sent on behalf of ${user.full_name ?? 'your notary'}`,
      greeting: custom ? undefined : `Hi ${signingJob.client_name ?? 'there'},`,
      intro:
        custom?.body ??
        `Your notary signing is scheduled for <strong style="color:#0F2C4E">${fmtInTz(signingJob.appointment_time, timezone)}</strong>.`,
      contentHtml: this.emailRenderer.detailBlock([
        ['Notary', user.full_name ?? 'Notary Day'],
        [
          'Date',
          fmtInTz(signingJob.appointment_time, timezone, { dateOnly: true }),
        ],
        ['Time', fmtInTz(signingJob.appointment_time, timezone)],
        ['Address', signingJob.address],
        ['Service', signingJob.signing_type.replace('_', ' ')],
      ]),
      plainText: `Your appointment is scheduled for ${fmtInTz(signingJob.appointment_time, timezone)} at ${signingJob.address}.`,
    });
    await this.notifications.sendEmail({
      to: signingJob.client_email,
      subject: custom?.subject ?? 'Your notary appointment is tomorrow',
      html: rendered.html,
      text: rendered.text,
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const timezone = (await this.userSettings.get(userId)).timezone ?? null;
    const etaDate = new Date(Date.now() + etaMins * 60_000);
    const template = await this.emailTemplates.findByType(userId, 'client_eta');
    const custom =
      template && template.is_active
        ? this.emailTemplates.render(template, {
            client_name: nextJob.client_name ?? 'there',
            notary_name: user.full_name ?? user.username,
            eta_time: fmtInTz(etaDate, timezone),
          })
        : null;

    const etaTime = fmtInTz(etaDate, timezone);
    const rendered = this.emailRenderer.render({
      title: 'Your notary is on the way',
      subtitle: 'Client ETA update',
      greeting: custom ? undefined : `Hi ${nextJob.client_name ?? 'there'},`,
      intro:
        custom?.body ??
        `Your notary is heading to you and will arrive at approximately <strong style="color:#0F2C4E">${etaTime}</strong>.`,
      contentHtml: this.emailRenderer.detailBlock([
        ['Address', nextJob.address],
        ['Service', nextJob.signing_type.replace('_', ' ')],
        ['Estimated arrival', etaTime],
      ]),
      footer: 'Please have your ID ready for the signing.',
      plainText: `Your notary is heading to you and will arrive at approximately ${etaTime}.`,
    });
    await this.notifications.sendEmail({
      to: nextJob.client_email,
      subject: custom?.subject ?? 'Your notary is on the way',
      html: rendered.html,
      text: rendered.text,
    });

    this.logger.log(
      `Client ETA sent to ${nextJob.client_email} · ${etaMins} min`,
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

    const rendered = this.emailRenderer.render({
      title: 'Your day is complete',
      subtitle: `Daily summary · ${day.toLocaleDateString()}`,
      greeting: `Hi ${user.full_name ?? user.username},`,
      intro: `${jobs.length} signings completed today.`,
      contentHtml: this.emailRenderer.detailBlock([
        ['Gross', `$${gross.toFixed(2)}`],
        ['Net', `$${net.toFixed(2)}`],
        ['Miles', miles.toFixed(1)],
      ]),
      plainText: `${jobs.length} signings completed. Gross $${gross.toFixed(2)}, net $${net.toFixed(2)}, miles ${miles.toFixed(1)}.`,
    });
    await this.notifications.sendEmail({
      to: user.email,
      subject: `Day summary: ${jobs.length} signings · $${net.toFixed(0)} net`,
      html: rendered.html,
      text: rendered.text,
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
