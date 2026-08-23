import { CalendarSyncProcessor } from './calendar-sync.processor';

describe('CalendarSyncProcessor', () => {
  const prisma = {
    userSettings: { findUnique: jest.fn() },
    job: { findUnique: jest.fn() },
  };
  const calendar = { getValidGoogleAccessToken: jest.fn() };
  const processor = new CalendarSyncProcessor(
    prisma as never,
    calendar as never,
  );
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userSettings.findUnique.mockResolvedValue({
      google_calendar_connected: true,
      google_calendar_token: { access_token: 'token' },
    });
    prisma.job.findUnique.mockResolvedValue({
      id: 'job-1',
      appointment_time: new Date('2026-08-17T10:00:00Z'),
      signing_duration_mins: 30,
      signing_ends_at: null,
      scanback_ends_at: null,
      signing_type: 'GENERAL',
      fee: 100,
      address: '1 Main St',
      client_name: 'Client',
    });
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('refreshes once on 401 and retries the request', async () => {
    calendar.getValidGoogleAccessToken
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('new');
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await processor.handleSyncJob({
      data: { userId: 'u1', jobId: 'job-1' },
    } as never);

    expect(calendar.getValidGoogleAccessToken).toHaveBeenLastCalledWith(
      'u1',
      true,
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rethrows retryable Google failures for Bull', async () => {
    calendar.getValidGoogleAccessToken.mockResolvedValue('token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('rate limited'),
    });
    await expect(
      processor.handleSyncJob({
        data: { userId: 'u1', jobId: 'job-1' },
      } as never),
    ).rejects.toThrow('status 429');
  });
});
