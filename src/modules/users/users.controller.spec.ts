import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { UsersController, UpdateSettingsDto } from './users.controller';
import { UsersService } from './users.service';
import { UserSettingsService } from './user-settings.service';
import { AuthService } from '../auth/auth.service';
import { SigningType } from '../../../generated/prisma';

describe('UsersController settings save', () => {
  let controller: UsersController;
  const userSettings = { update: jest.fn(), get: jest.fn() };
  const usersService = {
    updateOnboardingStep: jest.fn(),
    findById: jest.fn(),
    updateProfile: jest.fn(),
    changePassword: jest.fn(),
    softDeleteAccount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: UserSettingsService, useValue: userSettings },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();
    controller = module.get<UsersController>(UsersController);
  });

  it('passes booking_page_services and booking_page_active_hours through validation and to the settings service', async () => {
    const payload = {
      bookingPageEnabled: true,
      bookingPageBio: 'Certified LSA',
      booking_page_services: [
        {
          signing_type: SigningType.GENERAL,
          name: 'General Notary',
          duration_mins: 30,
          scanback_mins: 0,
          base_fee: 75,
        },
        {
          signing_type: SigningType.LOAN_REFI,
          name: 'Loan Refi',
          duration_mins: 60,
          scanback_mins: 20,
          base_fee: 125,
        },
      ],
      booking_page_active_hours: { Mon: { start: '08:00', end: '18:00' } },
      booking_min_notice_hours: 2,
      booking_advance_limit_days: 30,
      bookingBufferMins: 30,
      serviceAreaMiles: 30,
    };

    // Reproduce the global ValidationPipe config from main.ts
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const dto = (await pipe.transform(payload, {
      type: 'body',
      metatype: UpdateSettingsDto,
    } as never)) as UpdateSettingsDto;

    expect(dto.booking_page_services).toBeDefined();
    expect(dto.booking_page_services?.length).toBe(2);
    expect(dto.booking_page_services?.[0]).toMatchObject({
      signing_type: SigningType.GENERAL,
      base_fee: 75,
    });
    // Must survive JSON serialization (Prisma stores this column as JSONB).
    expect(
      (
        JSON.parse(JSON.stringify(dto.booking_page_services)) as Record<
          string,
          unknown
        >[]
      )[0],
    ).toMatchObject({
      signing_type: SigningType.GENERAL,
      name: 'General Notary',
    });
    expect(dto.booking_page_active_hours).toEqual({
      Mon: { start: '08:00', end: '18:00' },
    });

    await controller.updateSettings('user-1', dto);

    const updateArg = (
      userSettings.update.mock.calls as [string, Record<string, unknown>][]
    )[0][1];
    const services = updateArg.bookingPageServices as Record<string, unknown>[];
    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({
      signing_type: SigningType.GENERAL,
      name: 'General Notary',
    });
    expect(updateArg.bookingPageActiveHours).toEqual({
      Mon: { start: '08:00', end: '18:00' },
    });
    expect(updateArg.bookingMinNoticeHours).toBe(2);
    expect(updateArg.bookingAdvanceLimitDays).toBe(30);
    expect(updateArg.bookingBufferMins).toBe(30);
    expect(updateArg.serviceAreaMiles).toBe(30);
  });

  it('keeps booking_page_services when only active hours change', async () => {
    const payload = {
      booking_page_services: [{ signing_type: 'HYBRID', name: 'Hybrid' }],
      booking_page_active_hours: { Tue: { start: '09:00', end: '17:00' } },
    };
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const dto = (await pipe.transform(payload, {
      type: 'body',
      metatype: UpdateSettingsDto,
    } as never)) as UpdateSettingsDto;

    await controller.updateSettings('user-1', dto);
    const updateArg = (
      userSettings.update.mock.calls as [string, Record<string, unknown>][]
    )[0][1];
    const services = updateArg.bookingPageServices as Record<string, unknown>[];
    expect(services).toHaveLength(1);
    expect(services[0].signing_type).toBe('HYBRID');
  });

  it('persists state via the profile endpoint', async () => {
    usersService.updateProfile.mockResolvedValue({ id: 'user-1' });
    await controller.updateProfile('user-1', { state: 'Texas' });
    expect(usersService.updateProfile).toHaveBeenCalledWith('user-1', {
      fullName: undefined,
      phone: undefined,
      bio: undefined,
      nnaCertified: undefined,
      credentials: undefined,
    });
    const updateArg = (
      userSettings.update.mock.calls as [string, Record<string, unknown>][]
    )[0][1];
    expect(updateArg.state).toBe('Texas');
  });

  it('passes notificationPrefs through to the settings service', async () => {
    const payload = {
      notificationPrefs: {
        pre_sign_reminder: false,
        scanback_reminder: true,
      },
    };
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const dto = (await pipe.transform(payload, {
      type: 'body',
      metatype: UpdateSettingsDto,
    } as never)) as UpdateSettingsDto;

    await controller.updateSettings('user-1', dto);
    const updateArg = (
      userSettings.update.mock.calls as [string, Record<string, unknown>][]
    )[0][1];
    expect(updateArg.notificationPrefs).toEqual({
      pre_sign_reminder: false,
      scanback_reminder: true,
    });
  });

  it('changes password with current + new', async () => {
    await controller.changePassword('user-1', {
      currentPassword: 'old-pass',
      newPassword: 'new-pass-123',
    });
    expect(usersService.changePassword).toHaveBeenCalledWith(
      'user-1',
      'old-pass',
      'new-pass-123',
    );
  });

  it('rejects account deletion without DELETE confirmation', async () => {
    await expect(
      controller.deleteAccount('user-1', { confirmation: 'Delete' }),
    ).rejects.toThrow();
    expect(usersService.softDeleteAccount).not.toHaveBeenCalled();
  });

  it('soft-deletes account when confirmation is DELETE', async () => {
    const res = await controller.deleteAccount('user-1', {
      confirmation: 'DELETE',
    });
    expect(usersService.softDeleteAccount).toHaveBeenCalledWith('user-1');
    expect(res).toEqual({ success: true });
  });
});
