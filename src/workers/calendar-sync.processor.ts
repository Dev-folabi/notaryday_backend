import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_CALENDAR_SYNC } from '../queues/queue.constants';
import { CalendarService } from '../modules/calendar/calendar.service';

@Processor(QUEUE_CALENDAR_SYNC)
export class CalendarSyncProcessor {
  private readonly logger = new Logger(CalendarSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
  ) {}

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

    const endTime =
      signingJob.scanback_ends_at ??
      signingJob.signing_ends_at ??
      new Date(
        signingJob.appointment_time.getTime() +
          signingJob.signing_duration_mins * 60_000,
      );
    const request = async (accessToken: string) =>
      fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
      });

    let accessToken =
      await this.calendarService.getValidGoogleAccessToken(userId);
    let response = await request(accessToken);
    if (response.status === 401) {
      accessToken = await this.calendarService.getValidGoogleAccessToken(
        userId,
        true,
      );
      response = await request(accessToken);
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Google Calendar sync failed with status ${response.status}: ${body}`,
      );
    }

    this.logger.log(`Calendar event created for job ${jobId}`);
  }
}
