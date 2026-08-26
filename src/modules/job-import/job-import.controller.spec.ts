import { UnauthorizedException } from '@nestjs/common';
import { JobImportController } from './job-import.controller';

describe('JobImportController', () => {
  it('rejects an inbound webhook without a valid signature', async () => {
    const jobImport = {
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
      handleInbound: jest.fn(),
    };
    const controller = new JobImportController(jobImport as never);

    await expect(
      controller.handleInbound(
        { rawBody: Buffer.from('{}') } as never,
        'msg_123',
        '1700000000',
        'v1,bad-signature',
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jobImport.handleInbound).not.toHaveBeenCalled();
  });

  it('passes a verified inbound webhook to the import service', async () => {
    const jobImport = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      handleInbound: jest.fn().mockResolvedValue({
        status: 'queued',
        importId: 'import-1',
      }),
    };
    const controller = new JobImportController(jobImport as never);
    const body = {
      type: 'email.received',
      data: {
        email_id: 'email_123',
        from: 'sender@example.com',
        to: ['import+user1@inbound.notaryday.app'],
        subject: 'New signing',
        message_id: 'message_123',
      },
    };

    await expect(
      controller.handleInbound(
        { rawBody: Buffer.from(JSON.stringify(body)) } as never,
        'msg_123',
        '1700000000',
        'v1,signature',
        body,
      ),
    ).resolves.toEqual({
      success: true,
      data: { status: 'queued', importId: 'import-1' },
    });
    expect(jobImport.verifyWebhookSignature).toHaveBeenCalledWith(
      expect.any(Buffer),
      { id: 'msg_123', timestamp: '1700000000', signature: 'v1,signature' },
    );
    expect(jobImport.handleInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'sender@example.com',
        emailId: 'email_123',
        messageId: 'message_123',
      }),
    );
  });
});
