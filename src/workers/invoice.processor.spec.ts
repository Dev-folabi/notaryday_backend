/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { InvoiceProcessor } from './invoice.processor';

describe('InvoiceProcessor email attempts', () => {
  const prisma = {
    invoice: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const notifications = { sendEmail: jest.fn() };
  const settings = {
    getNotificationConfig: jest.fn(),
    get: jest.fn(),
  };
  const renderer = { render: jest.fn(), detailBlock: jest.fn() };
  const templates = { findByType: jest.fn(), render: jest.fn() };
  const config = { get: jest.fn().mockReturnValue({}) };
  const analytics = { track: jest.fn() };
  const service = new InvoiceProcessor(
    prisma as never,
    notifications as never,
    settings as never,
    renderer as never,
    templates as never,
    config as never,
    analytics as never,
  );
  const invoice = {
    id: 'inv-1',
    user_id: 'user-1',
    recipient_email: 'client@example.com',
    recipient_name: 'Client',
    invoice_number: 'INV-2026-0001',
    total: 100,
    pdf_url: null,
    user: { full_name: 'Notary', username: 'notary' },
    job: {
      signing_type: 'GENERAL',
      appointment_time: new Date('2026-08-17T10:00:00Z'),
      address: '1 Main St',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.invoice.update.mockResolvedValue({});
    settings.getNotificationConfig.mockResolvedValue({
      prefs: { client_invoice: true },
    });
    settings.get.mockResolvedValue({ timezone: 'UTC' });
    templates.findByType.mockResolvedValue(null);
    renderer.render.mockReturnValue({
      html: '<p>invoice</p>',
      text: 'invoice',
    });
    renderer.detailBlock.mockReturnValue('<dl>invoice</dl>');
    notifications.sendEmail.mockResolvedValue(undefined);
  });

  it('claims the expected initial attempt and clears state on success', async () => {
    await service.handleSendEmail({
      data: { invoiceId: 'inv-1', userId: 'user-1', attempt: 1 },
    } as never);

    expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email_attempts: 0 }),
        data: expect.objectContaining({ email_attempts: 1 }),
      }),
    );
    expect(prisma.invoice.update).toHaveBeenLastCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({
        email_pending: false,
        email_last_error: null,
        sent_at: expect.any(Date),
      }),
    });
  });

  it('keeps a failed retry pending below the maximum', async () => {
    notifications.sendEmail.mockRejectedValue(new Error('resend unavailable'));
    await expect(
      service.handleSendEmail({
        data: { invoiceId: 'inv-1', userId: 'user-1', attempt: 2 },
      } as never),
    ).rejects.toThrow('resend unavailable');
    expect(prisma.invoice.update).toHaveBeenLastCalledWith({
      where: { id: 'inv-1' },
      data: {
        email_pending: true,
        email_last_error: 'resend unavailable',
        email_failed_at: null,
      },
    });
  });

  it('marks the third failure terminal', async () => {
    notifications.sendEmail.mockRejectedValue(new Error('terminal'));
    await expect(
      service.handleSendEmail({
        data: { invoiceId: 'inv-1', userId: 'user-1', attempt: 3 },
      } as never),
    ).rejects.toThrow('terminal');
    expect(prisma.invoice.update).toHaveBeenLastCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({
        email_pending: false,
        email_last_error: 'terminal',
        email_failed_at: expect.any(Date),
      }),
    });
  });

  it('does nothing when another worker already claimed the attempt', async () => {
    prisma.invoice.updateMany.mockResolvedValue({ count: 0 });
    await service.handleSendEmail({
      data: { invoiceId: 'inv-1', userId: 'user-1', attempt: 2 },
    } as never);
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });
});
