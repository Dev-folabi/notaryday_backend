import { JobImportProcessor } from './job-import.processor';
import { ImportStatus } from '../../generated/prisma';

describe('JobImportProcessor', () => {
  const prisma = {
    jobImport: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };
  const config = { get: jest.fn() };
  const notifications = {
    sendPushToUser: jest.fn().mockResolvedValue(undefined),
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
  };
  const userSettings = {
    getNotificationConfig: jest.fn().mockResolvedValue({
      prefs: { job_imported: true, import_failed: true },
    }),
  };
  const emailRenderer = { render: jest.fn(() => ({ html: '', text: '' })) };
  const analytics = { track: jest.fn() };
  const extraction = {
    extractFromEmail: jest.fn(),
    extractFromScreenshot: jest.fn(),
  };

  let processor: JobImportProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new JobImportProcessor(
      prisma as never,
      config as never,
      notifications as never,
      userSettings as never,
      emailRenderer as never,
      analytics as never,
      extraction as never,
    );
    prisma.jobImport.findUnique.mockResolvedValue({
      id: 'imp-1',
      user_id: 'u1',
      raw_text: 'some email body',
      status: ImportStatus.QUEUED,
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'n@n.com' });
  });

  it('parses an email via the extraction service and persists results', async () => {
    extraction.extractFromEmail.mockResolvedValue({
      parsed: {
        address: '123 Main St, Austin, TX 78701',
        appointment_time: '2026-09-01T10:00:00',
        signing_type: 'GENERAL',
        fee: 150,
      },
      method: 'rule',
      confidence: 0.9,
    });

    await processor.handleParseEmail({ data: { importId: 'imp-1' } } as never);

    expect(extraction.extractFromEmail).toHaveBeenCalledWith('some email body');
    expect(prisma.jobImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ImportStatus.COMPLETE,
          parsed_address: '123 Main St, Austin, TX 78701',
          extraction_method: 'rule',
          extraction_confidence: 0.9,
        }) as object,
      }),
    );
  });

  it('marks an import FAILED when nothing extractable is found', async () => {
    extraction.extractFromEmail.mockResolvedValue({
      parsed: { notes: 'no real job here' },
      method: 'rule',
      confidence: 0.1,
    });

    await processor.handleParseEmail({ data: { importId: 'imp-1' } } as never);

    expect(prisma.jobImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ImportStatus.FAILED,
        }) as object,
      }),
    );
    expect(notifications.sendNotificationEmail).toHaveBeenCalled();
  });

  it('parses a screenshot via OCR + extraction service', async () => {
    // fetchScreenshot reads from R2 — mock the private via reflection is heavy;
    // instead stub prisma flow. We exercise the happy path with raw text in DB.
    extraction.extractFromScreenshot.mockResolvedValue({
      parsed: { address: '9 Pine Rd', appointment_time: '2026-09-02T09:00:00' },
      method: 'hybrid',
      confidence: 0.5,
      ocrText: 'signing text',
      aiModel: 'gemini-2.5-flash',
    });

    // Override fetchScreenshot by directly invoking the extraction service path
    // through a mocked R2: simplest is to test handleParseEmail only; for the
    // screenshot path we assert handleParseScreenshot delegates correctly.
    jest
      .spyOn(
        processor as unknown as { fetchScreenshot: () => Promise<Buffer> },
        'fetchScreenshot',
      )
      .mockResolvedValue(Buffer.from('fake-image'));

    await processor.handleParseScreenshot({
      data: { importId: 'imp-1', fileKey: 'k', mimetype: 'image/png' },
    } as never);

    expect(extraction.extractFromScreenshot).toHaveBeenCalledWith(
      Buffer.from('fake-image'),
      'image/png',
    );
    expect(prisma.jobImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          extraction_method: 'hybrid',
          ai_model_used: 'gemini-2.5-flash',
          ocr_text: 'signing text',
        }) as object,
      }),
    );
  });
});
