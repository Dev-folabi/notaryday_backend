/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { CalendarService } from './calendar.service';

describe('CalendarService Google tokens', () => {
  const prisma = {
    userSettings: { findUnique: jest.fn(), update: jest.fn() },
  };
  const config = { get: jest.fn((key: string) => key) };
  const redisClient = {
    set: jest.fn(),
    eval: jest.fn().mockResolvedValue(1),
  };
  const redis = { getClient: jest.fn(() => redisClient) };
  const service = new CalendarService(
    prisma as never,
    config as never,
    redis as never,
  );
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.set.mockResolvedValue('OK');
    prisma.userSettings.update.mockResolvedValue({});
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns a valid token without refreshing', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      google_calendar_connected: true,
      google_calendar_token: {
        access_token: 'valid',
        refresh_token: 'refresh',
        expires_at: Date.now() + 120_000,
      },
    });
    global.fetch = jest.fn();

    await expect(service.getValidGoogleAccessToken('u1')).resolves.toBe(
      'valid',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('proactively refreshes within 60 seconds and preserves refresh token', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      google_calendar_connected: true,
      google_calendar_token: {
        access_token: 'old',
        refresh_token: 'preserve-me',
        expires_at: Date.now() + 30_000,
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest
        .fn()
        .mockResolvedValue({ access_token: 'new', expires_in: 3600 }),
    });

    await expect(service.getValidGoogleAccessToken('u1')).resolves.toBe('new');
    expect(prisma.userSettings.update).toHaveBeenCalledWith({
      where: { user_id: 'u1' },
      data: {
        google_calendar_token: expect.objectContaining({
          access_token: 'new',
          refresh_token: 'preserve-me',
          expires_at: expect.any(Number),
        }),
      },
    });
  });

  it('stores a rotated refresh token', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      google_calendar_connected: true,
      google_calendar_token: {
        access_token: 'old',
        refresh_token: 'old-refresh',
        expires_at: 0,
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        access_token: 'new',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    });
    await service.getValidGoogleAccessToken('u1');
    expect(prisma.userSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          google_calendar_token: expect.objectContaining({
            refresh_token: 'new-refresh',
          }),
        },
      }),
    );
  });

  it('disconnects and records invalid_grant', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      google_calendar_connected: true,
      google_calendar_token: {
        access_token: 'old',
        refresh_token: 'bad',
        expires_at: 0,
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({
        error: 'invalid_grant',
        error_description: 'Token revoked',
      }),
    });

    await expect(service.getValidGoogleAccessToken('u1')).rejects.toThrow(
      'Token revoked',
    );
    expect(prisma.userSettings.update).toHaveBeenCalledWith({
      where: { user_id: 'u1' },
      data: {
        google_calendar_connected: false,
        google_calendar_token: expect.objectContaining({
          error: 'Token revoked',
        }),
      },
    });
  });

  it('rethrows transient refresh failures without disconnecting', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      google_calendar_connected: true,
      google_calendar_token: {
        access_token: 'old',
        refresh_token: 'refresh',
        expires_at: 0,
      },
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(service.getValidGoogleAccessToken('u1')).rejects.toThrow(
      'network down',
    );
    expect(prisma.userSettings.update).not.toHaveBeenCalled();
  });
});
