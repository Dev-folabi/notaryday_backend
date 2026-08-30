import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_CALENDAR_SYNC } from '../queues/queue.constants';
import { CalendarService } from '../modules/calendar/calendar.service';

interface CalendarEvent {
  id?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string };
}

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

    const summary = `${signingJob.signing_type.replace('_', ' ')} · $${signingJob.fee.toString()}`;
    const description = [
      signingJob.client_name,
      `Fee: $${signingJob.fee.toString()}`,
    ]
      .filter(Boolean)
      .join('\n');

    let accessToken =
      await this.calendarService.getValidGoogleAccessToken(userId);

    // Find existing event to update (avoids duplicates on edit)
    const existingEventId = await this.findMatchingEvent(
      accessToken,
      signingJob.appointment_time,
      signingJob.address,
    );

    const method = existingEventId ? 'PUT' : 'POST';
    const url = existingEventId
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`
      : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

    const request = async (token: string) =>
      fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary,
          location: signingJob.address,
          start: { dateTime: signingJob.appointment_time.toISOString() },
          end: { dateTime: endTime.toISOString() },
          description,
        }),
      });

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

    this.logger.log(
      `Calendar event ${existingEventId ? 'updated' : 'created'} for job ${jobId}`,
    );
  }

  @Process('delete-event')
  async handleDeleteEvent(job: Job<{ userId: string; jobId: string }>) {
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

    let accessToken =
      await this.calendarService.getValidGoogleAccessToken(userId);

    const existingEventId = await this.findMatchingEvent(
      accessToken,
      signingJob.appointment_time,
      signingJob.address,
    );

    if (!existingEventId) {
      this.logger.log(
        `No Google Calendar event found for deleted job ${jobId}`,
      );
      return;
    }

    const request = async (token: string) =>
      fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

    let response = await request(accessToken);
    if (response.status === 401) {
      accessToken = await this.calendarService.getValidGoogleAccessToken(
        userId,
        true,
      );
      response = await request(accessToken);
    }
    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new Error(
        `Google Calendar delete failed with status ${response.status}: ${body}`,
      );
    }

    this.logger.log(
      `Calendar event ${existingEventId} deleted for job ${jobId}`,
    );
  }

  /**
   * Search for an existing Google Calendar event that matches the job's
   * appointment time (±1 h window) and address.  Returns the event id or
   * null when nothing is found.
   */
  private async findMatchingEvent(
    accessToken: string,
    appointmentTime: Date,
    address: string,
  ): Promise<string | null> {
    const windowStart = new Date(appointmentTime.getTime() - 3600_000);
    const windowEnd = new Date(appointmentTime.getTime() + 3600_000);

    const params = new URLSearchParams({
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: 'true',
      q: address,
      maxResults: '10',
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { items?: CalendarEvent[] };
    const items = data.items ?? [];

    // Prefer exact address match, then fall back to the first item in the
    // window (best-effort — avoids silent failures when Google normalises
    // the address differently).
    const exactMatch = items.find(
      (e) => e.location?.trim().toLowerCase() === address.trim().toLowerCase(),
    );
    return exactMatch?.id ?? items[0]?.id ?? null;
  }
}
