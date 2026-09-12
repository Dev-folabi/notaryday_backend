import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { TransactionalEmailService } from './transactional-email.service';

describe('TransactionalEmailService', () => {
  let service: TransactionalEmailService;
  let config: { get: jest.Mock };
  let prisma: { systemSettings: { findUnique: jest.Mock } };

  const createService = (
    resendKey = 'test-resend-key',
    brevoKey = 'test-brevo-key',
  ) => {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return resendKey;
        if (key === 'RESEND_FROM_ADDRESS')
          return 'Notary Day <noreply@notaryday.app>';
        if (key === 'BREVO_API_KEY') return brevoKey;
        if (key === 'BREVO_FROM_ADDRESS')
          return 'Notary Day <noreply@notaryday.app>';
        return '';
      }),
    };
    prisma = {
      systemSettings: { findUnique: jest.fn() },
    };
    service = new TransactionalEmailService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
  };

  beforeEach(() => jest.clearAllMocks());

  describe('getActiveProvider', () => {
    it('defaults to resend when no setting exists', async () => {
      createService();
      prisma.systemSettings.findUnique.mockResolvedValue(null);

      const result = await service.getActiveProvider();
      expect(result).toBe('resend');
    });

    it('reads brevo when set in DB', async () => {
      createService();
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'brevo',
      });

      const result = await service.getActiveProvider();
      expect(result).toBe('brevo');
    });

    it('falls back to resend when DB says brevo but Brevo is not configured', async () => {
      createService('test-resend-key', '');
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'brevo',
      });

      const result = await service.getActiveProvider();
      expect(result).toBe('resend');
    });

    it('caches the provider for 30s', async () => {
      createService();
      prisma.systemSettings.findUnique.mockResolvedValue(null);

      await service.getActiveProvider();
      await service.getActiveProvider();
      expect(prisma.systemSettings.findUnique).toHaveBeenCalledTimes(1);
    });

    it('falls back to resend when DB says invalid provider', async () => {
      createService();
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'unknown',
      });

      const result = await service.getActiveProvider();
      expect(result).toBe('resend');
    });
  });

  describe('clearCache', () => {
    it('forces a DB re-read after clearing', async () => {
      createService();
      prisma.systemSettings.findUnique.mockResolvedValue(null);

      await service.getActiveProvider();
      service.clearCache();
      await service.getActiveProvider();
      expect(prisma.systemSettings.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProviderStatus', () => {
    it('returns both providers and active', async () => {
      createService('test-resend-key', '');
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'resend',
      });

      const status = await service.getProviderStatus();
      expect(status.active).toBe('resend');
      expect(status.providers).toHaveLength(2);
      expect(status.providers[0]).toMatchObject({
        type: 'resend',
        configured: true,
        label: 'Resend',
      });
      expect(status.providers[1]).toMatchObject({
        type: 'brevo',
        configured: false,
        label: 'Brevo',
      });
    });
  });

  describe('send', () => {
    it('uses the active provider when configured', async () => {
      createService('test-resend-key', 'test-brevo-key');
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'resend',
      });

      const resendMailer = service['getResendMailer']();
      jest.spyOn(resendMailer, 'send').mockResolvedValue({
        provider: 'resend',
        messageId: 'resend-msg-1',
      });

      const result = await service.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>hi</p>',
      });
      expect(result.provider).toBe('resend');
      expect(result.messageId).toBe('resend-msg-1');
    });

    it('falls back to Brevo when active (Resend) fails', async () => {
      createService('test-resend-key', 'test-brevo-key');
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'resend',
      });

      const resendMailer = service['getResendMailer']();
      const brevoMailer = service['getBrevoMailer']();
      jest
        .spyOn(resendMailer, 'send')
        .mockRejectedValue(new Error('Resend down'));
      jest.spyOn(brevoMailer, 'send').mockResolvedValue({
        provider: 'brevo',
        messageId: 'brevo-123',
      });

      const result = await service.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>hi</p>',
      });
      expect(result.provider).toBe('brevo');
      expect(result.messageId).toBe('brevo-123');
    });

    it('falls back to Resend when active (Brevo) fails', async () => {
      createService('test-resend-key', 'test-brevo-key');
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'brevo',
      });

      const resendMailer = service['getResendMailer']();
      const brevoMailer = service['getBrevoMailer']();
      jest
        .spyOn(brevoMailer, 'send')
        .mockRejectedValue(new Error('Brevo down'));
      jest.spyOn(resendMailer, 'send').mockResolvedValue({
        provider: 'resend',
        messageId: 'resend-123',
      });

      const result = await service.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>hi</p>',
      });
      expect(result.provider).toBe('resend');
      expect(result.messageId).toBe('resend-123');
    });

    it('throws combined error when both providers fail', async () => {
      createService('test-resend-key', 'test-brevo-key');
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'resend',
      });

      const resendMailer = service['getResendMailer']();
      const brevoMailer = service['getBrevoMailer']();
      jest
        .spyOn(resendMailer, 'send')
        .mockRejectedValue(new Error('Resend error'));
      jest
        .spyOn(brevoMailer, 'send')
        .mockRejectedValue(new Error('Brevo error'));

      await expect(
        service.send({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>hi</p>',
        }),
      ).rejects.toThrow(/all providers/i);
    });

    it('tries fallback when active provider is not configured', async () => {
      createService('', 'test-brevo-key');
      prisma.systemSettings.findUnique.mockResolvedValue({
        key: 'transactional_email_provider',
        value: 'resend',
      });

      const brevoMailer = service['getBrevoMailer']();
      jest.spyOn(brevoMailer, 'send').mockResolvedValue({
        provider: 'brevo',
        messageId: 'brevo-456',
      });

      const result = await service.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>hi</p>',
      });
      expect(result.provider).toBe('brevo');
    });

    it('throws when no provider has an API key', async () => {
      createService('', '');
      prisma.systemSettings.findUnique.mockResolvedValue(null);

      await expect(
        service.send({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>hi</p>',
        }),
      ).rejects.toThrow(/not configured/);
    });
  });

  describe('testProvider', () => {
    it('sends via the specified provider', async () => {
      createService('test-resend-key', 'test-brevo-key');
      const resendMailer = service['getResendMailer']();
      jest.spyOn(resendMailer, 'send').mockResolvedValue({
        provider: 'resend',
        messageId: 'resend-test',
      });

      const result = await service.testProvider('resend', {
        to: 'admin@example.com',
        subject: 'Test',
        html: '<p>test</p>',
      });
      expect(result.provider).toBe('resend');
      expect(result.messageId).toBe('resend-test');
    });

    it('throws when the specified provider is not configured', async () => {
      createService('', '');
      await expect(
        service.testProvider('resend', {
          to: 'admin@example.com',
          subject: 'Test',
          html: '<p>test</p>',
        }),
      ).rejects.toThrow(/not configured/i);
    });
  });
});
