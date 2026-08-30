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
      name: `${user.full_name} · Notary Day`,
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
        summary: `${job.signing_type.replace('_', ' ')} · $${job.fee.toString()}`,
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
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        typeof body.error_description === 'string'
          ? body.error_description
          : `Google token exchange failed with status ${res.status}`,
      );
    }
    const tokens = this.normalizeGoogleTokens(body);

    await this.prisma.userSettings.update({
      where: { user_id: userId },
      data: {
        google_calendar_token: tokens,
        google_calendar_connected: true,
      },
    });

    return { connected: true };
  }

  async getValidGoogleAccessToken(
    userId: string,
    forceRefresh = false,
  ): Promise<string> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { user_id: userId },
      select: {
        google_calendar_connected: true,
        google_calendar_token: true,
      },
    });
    if (
      !settings?.google_calendar_connected ||
      !settings.google_calendar_token
    ) {
      throw new Error('Google Calendar is not connected');
    }

    const tokens = this.normalizeGoogleTokens(
      settings.google_calendar_token as Record<string, unknown>,
    );
    const expiresAt = Number(tokens.expires_at ?? 0);
    if (
      !forceRefresh &&
      typeof tokens.access_token === 'string' &&
      expiresAt > Date.now() + 60_000
    ) {
      return tokens.access_token;
    }

    return this.refreshGoogleAccessToken(userId, tokens);
  }

  private normalizeGoogleTokens(
    raw: Record<string, unknown>,
    previous?: Record<string, unknown>,
  ): Prisma.InputJsonObject {
    const expiresIn = Number(raw.expires_in ?? 0);
    const rawExpiresAt = raw.expires_at ?? raw.expiry;
    const expiresAt =
      expiresIn > 0 ? Date.now() + expiresIn * 1000 : Number(rawExpiresAt ?? 0);

    const normalized: Record<string, unknown> = {
      ...previous,
      ...raw,
      expires_at: expiresAt,
      error: null,
    };
    const accessToken =
      typeof raw.access_token === 'string'
        ? raw.access_token
        : previous?.access_token;
    const refreshToken =
      typeof raw.refresh_token === 'string' && raw.refresh_token
        ? raw.refresh_token
        : previous?.refresh_token;
    if (typeof accessToken === 'string') normalized.access_token = accessToken;
    if (typeof refreshToken === 'string') {
      normalized.refresh_token = refreshToken;
    }
    return normalized as Prisma.InputJsonObject;
  }

  private async refreshGoogleAccessToken(
    userId: string,
    tokens: Prisma.InputJsonObject,
  ): Promise<string> {
    const redis = this.redis.getClient();
    const lockKey = `calendar-refresh:${userId}`;
    const lockValue = crypto.randomUUID();
    const acquired = await redis.set(lockKey, lockValue, 'PX', 15_000, 'NX');

    if (!acquired) {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const current = await this.prisma.userSettings.findUnique({
          where: { user_id: userId },
          select: {
            google_calendar_connected: true,
            google_calendar_token: true,
          },
        });
        if (!current?.google_calendar_connected) {
          throw new Error('Google Calendar is not connected');
        }
        const currentTokens = this.normalizeGoogleTokens(
          current.google_calendar_token as Record<string, unknown>,
        );
        if (
          typeof currentTokens.access_token === 'string' &&
          Number(currentTokens.expires_at ?? 0) > Date.now() + 60_000
        ) {
          return currentTokens.access_token;
        }
      }
      throw new Error('Google token refresh is already in progress');
    }

    try {
      const refreshToken = tokens.refresh_token;
      if (typeof refreshToken !== 'string' || !refreshToken) {
        await this.disconnectGoogleCalendar(
          userId,
          tokens,
          'Missing refresh token',
        );
        throw new Error('Missing Google refresh token');
      }

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.config.get<string>('GOOGLE_CLIENT_ID') ?? '',
          client_secret: this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const errorCode = typeof body.error === 'string' ? body.error : null;
        const message =
          typeof body.error_description === 'string'
            ? body.error_description
            : `Google token refresh failed with status ${response.status}`;
        if (errorCode === 'invalid_grant') {
          await this.disconnectGoogleCalendar(userId, tokens, message);
        }
        throw new Error(message);
      }

      const normalized = this.normalizeGoogleTokens(body, tokens);
      await this.prisma.userSettings.update({
        where: { user_id: userId },
        data: { google_calendar_token: normalized },
      });
      return normalized.access_token as string;
    } finally {
      await redis
        .eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1,
          lockKey,
          lockValue,
        )
        .catch(() => undefined);
    }
  }

  private async disconnectGoogleCalendar(
    userId: string,
    tokens: Prisma.InputJsonObject,
    error: string,
  ) {
    await this.prisma.userSettings.update({
      where: { user_id: userId },
      data: {
        google_calendar_connected: false,
        google_calendar_token: { ...tokens, error },
      },
    });
  }

  /** User-initiated disconnect from Google Calendar */
  async disconnect(userId: string) {
    await this.prisma.userSettings.update({
      where: { user_id: userId },
      data: {
        google_calendar_connected: false,
        google_calendar_token: Prisma.JsonNull,
      },
    });
    return { disconnected: true };
  }
}
