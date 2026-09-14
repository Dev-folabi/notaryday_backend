import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from './notifications.service';
import { EmailRendererService } from '../../common/email/email-renderer.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
import type { Queue } from 'bull';

describe('NotificationsService web push', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'RESEND_API_KEY') return 'test-resend-key';
      if (key === 'RESEND_FROM_ADDRESS') return 'test@example.com';
      return '';
    }),
  };
  const prisma = {
    pushSubscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    userSettings: { findUnique: jest.fn() },
  };
  const transactionalEmail = {
    send: jest
      .fn()
      .mockResolvedValue({ provider: 'resend', messageId: 'test-123' }),
  };

  beforeEach(() => jest.clearAllMocks());

  it('stores a browser subscription for the authenticated user', async () => {
    const service = new NotificationsService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      {} as EmailRendererService,
      transactionalEmail as unknown as TransactionalEmailService,
      {} as unknown as Queue,
    );
    prisma.pushSubscription.upsert.mockResolvedValue({ id: 'subscription-1' });
    prisma.pushSubscription.findUnique.mockResolvedValue(null);

    await service.savePushSubscription('user-1', {
      endpoint: 'https://push.example/subscription',
      p256dh: 'key',
      auth: 'auth',
      user_agent: 'test-agent',
    });

    const call = prisma.pushSubscription.upsert.mock.calls[0] as unknown as [
      {
        where: { endpoint: string };
        create: { user_id: string };
      },
    ];
    expect(call[0].where.endpoint).toBe('https://push.example/subscription');
    expect(call[0].create.user_id).toBe('user-1');
  });

  it('does not query subscriptions when VAPID is not configured', async () => {
    const service = new NotificationsService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      {} as EmailRendererService,
      transactionalEmail as unknown as TransactionalEmailService,
      {} as unknown as Queue,
    );

    await service.sendPushToUser('user-1', {
      title: 'Reminder',
      body: 'Test',
    });

    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });
});
