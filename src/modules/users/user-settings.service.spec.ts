import { UserSettingsService } from './user-settings.service';
import { PrismaService } from '../../config/prisma.service';

describe('UserSettingsService notification config', () => {
  const prisma = {
    userSettings: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const service = new UserSettingsService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('uses enabled defaults when no granular preferences are stored', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      reminders_enabled: true,
      reminder_lead_mins: 45,
      client_eta_enabled: true,
      notification_prefs: null,
    });

    const config = await service.getNotificationConfig('user-1');

    expect(config.reminderLeadMins).toBe(45);
    expect(config.prefs.pre_sign_reminder).toBe(true);
    expect(config.prefs.client_invoice).toBe(true);
  });

  it('merges stored preferences without disabling unspecified channels', async () => {
    prisma.userSettings.findUnique.mockResolvedValue({
      reminders_enabled: false,
      reminder_lead_mins: 90,
      client_eta_enabled: false,
      notification_prefs: {
        pre_sign_reminder: false,
        client_invoice: false,
      },
    });

    const config = await service.getNotificationConfig('user-1');

    expect(config.remindersEnabled).toBe(false);
    expect(config.clientEtaEnabled).toBe(false);
    expect(config.prefs.pre_sign_reminder).toBe(false);
    expect(config.prefs.client_invoice).toBe(false);
    expect(config.prefs.new_booking_received).toBe(true);
  });
});
