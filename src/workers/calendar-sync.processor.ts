import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_CALENDAR_SYNC } from '../queues/queue.constants';

@Processor(QUEUE_CALENDAR_SYNC)
export class CalendarSyncProcessor {
  private readonly logger = new Logger(CalendarSyncProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process('sync-job')
  async handleSyncJob(job: Job<{ userId: string; jobId: string }>) {
    const { userId, jobId } = job.data;
    const settings = await this.prisma.userSettings.findUnique({
      where: { user_id: userId },
    });
    if (!settings?.google_calendar_connected || !settings.google_calendar_token)
      return;

    const signingJob = await this.prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!signingJob) return;

    const tokens = settings.google_calendar_token as { access_token: string };
    try {
      const endTime =
        signingJob.scanback_ends_at ??
        signingJob.signing_ends_at ??
        new Date(
          signingJob.appointment_time.getTime() +
            signingJob.signing_duration_mins * 60_000,
        );

      await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: `${signingJob.signing_type.replace('_', ' ')} · $${signingJob.fee.toString()}`,
            location: signingJob.address,
            start: { dateTime: signingJob.appointment_time.toISOString() },
            end: { dateTime: endTime.toISOString() },
            description: [
              signingJob.client_name,
              `Fee: $${signingJob.fee.toString()}`,
            ]
              .filter(Boolean)
              .join('\n'),
          }),
        },
      );

      this.logger.log(`Calendar event created for job ${jobId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Calendar sync failed for job ${jobId}: ${errorMessage}`,
      );
    }
  }
}
