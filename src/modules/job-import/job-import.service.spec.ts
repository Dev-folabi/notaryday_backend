import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { JobImportService } from './job-import.service';
import { PrismaService } from '../../config/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import {
  ImportStatus,
  ImportType,
  JobSource,
  JobStatus,
} from '../../../generated/prisma';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
}));

describe('JobImportService', () => {
  let service: JobImportService;
  const prisma = {
    user: { findUnique: jest.fn() },
    jobImport: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const config = { get: jest.fn() };
  const queue = { add: jest.fn() };
  const jobsService = { create: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: JobsService, useValue: jobsService },
        { provide: getQueueToken('job-import'), useValue: queue },
      ],
    }).compile();

    service = module.get<JobImportService>(JobImportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleInbound', () => {
    it('creates an EMAIL import record and enqueues parse-email', async () => {
      config.get.mockReturnValue('import.notaryday.app');
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.jobImport.create.mockResolvedValue({ id: 'import-1' });
      queue.add.mockResolvedValue({ id: 'job-1' });

      const result = await service.handleInbound({
        from: 'sender@snapdocs.com',
        to: ['import+user1@import.notaryday.app'],
        subject: 'New order',
        text: 'Signing at 123 Main St',
        messageId: 'msg-1',
      });

      expect(prisma.jobImport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-1',
            import_type: ImportType.EMAIL,
            status: ImportStatus.QUEUED,
          }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'parse-email',
        expect.objectContaining({ importId: 'import-1' }),
        expect.objectContaining({ priority: 1 }),
      );
      expect(result).toEqual({ status: 'queued', importId: 'import-1' });
    });
  });

  describe('handleUpload', () => {
    it('creates a SCREENSHOT import record and enqueues parse-screenshot', async () => {
      config.get.mockImplementation((key: string) => {
        if (key.startsWith('R2_')) return 'configured';
        return undefined;
      });
      prisma.jobImport.create.mockResolvedValue({ id: 'import-2' });
      queue.add.mockResolvedValue({ id: 'job-2' });

      const file = {
        originalname: 'order.png',
        buffer: Buffer.from('fake-image'),
        mimetype: 'image/png',
      };

      const result = await service.handleUpload('user-1', file);

      expect(prisma.jobImport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'user-1',
            import_type: ImportType.SCREENSHOT,
            file_mimetype: 'image/png',
            status: ImportStatus.QUEUED,
          }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'parse-screenshot',
        expect.objectContaining({ importId: 'import-2' }),
      );
      expect(result).toEqual({ status: 'queued', importId: 'import-2' });
    });

    it('throws when R2 is not configured', async () => {
      config.get.mockReturnValue(undefined);
      await expect(
        service.handleUpload('user-1', {
          originalname: 'x.png',
          buffer: Buffer.from('x'),
          mimetype: 'image/png',
        }),
      ).rejects.toThrow('R2 credentials');
    });
  });

  describe('findAll', () => {
    it('excludes CONFIRMED and DECLINED imports', async () => {
      prisma.jobImport.findMany.mockResolvedValue([]);
      await service.findAll('user-1');
      expect(prisma.jobImport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 'user-1',
            status: { notIn: [ImportStatus.CONFIRMED, ImportStatus.DECLINED] },
          },
        }),
      );
    });
  });

  describe('confirm', () => {
    it('delegates to JobsService.create and marks import CONFIRMED', async () => {
      prisma.jobImport.findFirst.mockResolvedValue({
        id: 'import-3',
        user_id: 'user-1',
        import_type: ImportType.SCREENSHOT,
        status: ImportStatus.COMPLETE,
        parsed_address: '123 Main St',
        parsed_appointment_time: new Date('2026-08-05T14:00:00Z'),
        parsed_signing_type: 'GENERAL',
        parsed_fee: 125,
        parsed_platform_fee: 0,
        parsed_platform_name: 'SigningOrder',
      });
      jobsService.create.mockResolvedValue({ id: 'job-3' });
      prisma.jobImport.update.mockResolvedValue({});

      const job = await service.confirm('user-1', 'import-3');

      expect(jobsService.create).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          address: '123 Main St',
          source: JobSource.SCREENSHOT,
          status: JobStatus.PENDING,
          platform_name: 'SigningOrder',
        }),
        undefined,
        'import-3',
      );
      expect(prisma.jobImport.update).toHaveBeenCalledWith({
        where: { id: 'import-3' },
        data: { status: ImportStatus.CONFIRMED },
      });
      expect(job).toEqual({ id: 'job-3' });
    });
  });

  describe('decline', () => {
    it('marks the import DECLINED', async () => {
      prisma.jobImport.findFirst.mockResolvedValue({
        id: 'import-4',
        user_id: 'user-1',
      });
      prisma.jobImport.update.mockResolvedValue({});

      const result = await service.decline('user-1', 'import-4');

      expect(prisma.jobImport.update).toHaveBeenCalledWith({
        where: { id: 'import-4' },
        data: { status: ImportStatus.DECLINED },
      });
      expect(result).toEqual({ declined: true, importId: 'import-4' });
    });
  });
});
