import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { JobStatus, Prisma } from '../../../generated/prisma';
import ical, { ICalCalendarMethod } from 'ical-generator';
import { RedisService } from '../../config/redis.service';

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /** Generate ICS feed for a user by token */
  async generateFeed(token: string): Promise<string> {
    const settings = await this.prisma.userSettings.findFirst({
      where: { ics_feed_token: token },
    });
    if (!settings) throw new NotFoundException('Invalid feed token');

    const user = await this.prisma.user.findUnique({
      where: { id: settings.user_id },
    });
    if (!user) throw new NotFoundException('User not found');

    const jobs = await this.prisma.job.findMany({
      where: {
        user_id: settings.user_id,
        deleted_at: null,
        status: {
          in: [JobStatus.CONFIRMED, JobStatus.IN_PROGRESS, JobStatus.COMPLETE],
        },
      },
      orderBy: { appointment_time: 'desc' },
      take: 200,
    });

    const cal = ical({
      name: `${user.full_name} — Notary Day`,
      method: ICalCalendarMethod.PUBLISH,
    });

    for (const job of jobs) {
      const endTime =
        job.scanback_ends_at ??
        job.signing_ends_at ??
        new Date(
          job.appointment_time.getTime() + job.signing_duration_mins * 60_000,
        );
      cal.createEvent({
        start: job.appointment_time,
        end: endTime,
        summary: `${job.signing_type.replace('_', ' ')} — $${job.fee.toString()}`,
        location: job.address,
        description: [
          job.client_name ? `Client: ${job.client_name}` : null,
          `Fee: $${job.fee.toString()}`,
          `Duration: ${job.signing_duration_mins} min`,
          job.scanback_duration_mins > 0
            ? `Scanback: ${job.scanback_duration_mins} min`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }

    return cal.toString();
  }

  /** Generate or get existing feed token for a user */
  async getOrCreateFeedToken(userId: string): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { user_id: userId },
    });
    if (settings?.ics_feed_token) return settings.ics_feed_token;

    const token = crypto.randomUUID().replace(/-/g, '');
    await this.prisma.userSettings.update({
      where: { user_id: userId },
      data: { ics_feed_token: token },
    });
    return token;
  }

  /** Google OAuth: get redirect URL */
  getGoogleAuthUrl(state: string): string {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const redirectUri =
      this.config.get<string>('GOOGLE_REDIRECT_URI') ??
      'http://localhost:4000/api/v1/calendar/auth/google/callback';
    const scope = 'https://www.googleapis.com/auth/calendar.events';
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&access_type=offline&prompt=consent`;
  }

  async storeOAuthState(state: string, userId: string): Promise<void> {
    // Store state for 10 minutes
    await this.redis.getClient().set(`oauth_state:${state}`, userId, 'EX', 600);
  }

  async getUserIdFromOAuthState(state: string): Promise<string | null> {
    const userId = await this.redis.getClient().get(`oauth_state:${state}`);
    return userId;
  }

  /** Google OAuth: exchange code for tokens */
  async handleGoogleCallback(code: string, userId: string) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri =
      this.config.get<string>('GOOGLE_REDIRECT_URI') ??
      'http://localhost:4000/api/v1/calendar/auth/google/callback';

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await res.json()) as Prisma.InputJsonObject;

    await this.prisma.userSettings.update({
      where: { user_id: userId },
      data: {
        google_calendar_token: tokens,
        google_calendar_connected: true,
      },
    });

    return { connected: true };
  }
}
