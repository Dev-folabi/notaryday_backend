import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../../config/prisma.service';
import { QUEUE_SCREENSHOT_IMPORT } from '../../queues/queue.constants';
import { ImportStatus } from '../../../generated/prisma';

@Injectable()
export class ScreenshotImportService {
  private readonly logger = new Logger(ScreenshotImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_SCREENSHOT_IMPORT) private readonly queue: Queue,
  ) {}

  /** Handle uploaded screenshot */
  async handleUpload(
    userId: string,
    file: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    const r2AccountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('R2_BUCKET_NAME');

    if (!r2AccountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        'R2 credentials are not fully configured in environment variables.',
      );
    }

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const fileKey = `screenshots/${userId}/${Date.now()}-${file.originalname}`;

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      this.logger.log(`Uploaded screenshot to R2: ${fileKey}`);
    } catch (error) {
      this.logger.error(`R2 Upload failed: ${(error as Error).message}`);
      throw new Error('Failed to upload screenshot');
    }

    // Create import record (reuse EmailImport model with source indicator)
    const importRecord = await this.prisma.emailImport.create({
      data: {
        user_id: userId,
        resend_message_id: `screenshot-${Date.now()}`,
        from_address: 'screenshot-upload',
        subject: file.originalname,
        raw_text: fileKey,
        status: ImportStatus.QUEUED,
        received_at: new Date(),
      },
    });

    // Queue for AI vision processing
    await this.queue.add('parse-screenshot', {
      importId: importRecord.id,
      fileKey,
      mimetype: file.mimetype,
    });

    return { status: 'queued', importId: importRecord.id };
  }
}
