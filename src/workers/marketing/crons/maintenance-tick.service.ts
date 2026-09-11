import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Campaign,
  CampaignDocument,
} from '../../../modules/marketing/schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../../../modules/marketing/schemas/campaign-recipient.schema';
import {
  ImportJob,
  ImportJobDocument,
} from '../../../modules/marketing/schemas/import-job.schema';
import { QUEUE_MARKETING } from '../../../queues/queue.constants';

const STALE_SENDING_MS = 10 * 60_000;
const STUCK_QUEUED_IMPORT_MS = 10 * 60_000;
const STALE_PROCESSING_IMPORT_MS = 30 * 60_000;
const MAX_IMPORT_REQUEUES = 3;

/**
 * Housekeeping: requeue recipients stuck in SENDING (worker crash between
 * claim and send), flip RUNNING campaigns to COMPLETED once nothing is
 * queued or in flight, and recover imports whose queue jobs were lost
 * (e.g. Redis flush, worker pointed at a different Mongo).
 */
@Injectable()
export class MaintenanceTickService {
  private readonly logger = new Logger(MaintenanceTickService.name);

  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(ImportJob.name)
    private readonly jobModel: Model<ImportJobDocument>,
    @InjectQueue(QUEUE_MARKETING) private readonly marketingQueue: Queue,
  ) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    try {
      const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
      const requeued = await this.recipientModel
        .updateMany(
          { status: 'SENDING', claimedAt: { $lt: staleBefore } },
          { $set: { status: 'QUEUED', claimedAt: null } },
        )
        .exec();
      if (requeued.modifiedCount > 0) {
        this.logger.warn(
          `Requeued ${requeued.modifiedCount} stale SENDING recipients`,
        );
      }

      const running = await this.campaignModel
        .find({ status: 'RUNNING' })
        .select('_id name')
        .exec();
      for (const campaign of running) {
        const active = await this.recipientModel
          .countDocuments({
            campaignRef: campaign._id,
            status: { $in: ['QUEUED', 'SENDING'] },
          })
          .exec();
        if (active === 0) {
          await this.campaignModel
            .updateOne(
              { _id: campaign._id, status: 'RUNNING' },
              { $set: { status: 'COMPLETED', completedAt: new Date() } },
            )
            .exec();
          this.logger.log(`Campaign "${campaign.name}" completed`);
        }
      }

      await this.recoverStuckImports();
    } catch (error) {
      this.logger.error(
        `maintenance-tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Imports stuck QUEUED past the pickup window: their queue job was lost or
   * silently dropped — re-enqueue (capped). Imports stuck PROCESSING past the
   * runtime window: the worker died mid-run — fail them so they can be retried
   * manually (ingest upserts make retries idempotent).
   */
  private async recoverStuckImports(): Promise<void> {
    const now = Date.now();

    const stuckQueued = await this.jobModel
      .find({
        status: 'QUEUED',
        updatedAt: { $lt: new Date(now - STUCK_QUEUED_IMPORT_MS) },
      })
      .limit(20)
      .exec();
    for (const job of stuckQueued) {
      if ((job.requeueCount ?? 0) >= MAX_IMPORT_REQUEUES) {
        await this.jobModel
          .updateOne(
            { _id: job._id },
            {
              $set: {
                status: 'FAILED',
                error: `Worker did not pick up this import after ${MAX_IMPORT_REQUEUES} requeues — check the marketing worker and MONGODB_URI (must include the database name).`,
                completedAt: new Date(),
              },
            },
          )
          .exec();
        this.logger.error(
          `Import ${String(job._id)} ("${job.filename}") failed: never picked up`,
        );
        continue;
      }
      await this.jobModel
        .updateOne(
          { _id: job._id },
          { $inc: { requeueCount: 1 }, $set: { updatedAt: new Date() } },
        )
        .exec();
      await this.marketingQueue
        .add('import-file', { importId: String(job._id) })
        .catch((error) =>
          this.logger.error(
            `Failed to requeue import ${String(job._id)}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      this.logger.warn(
        `Re-enqueued stuck import ${String(job._id)} ("${job.filename}", attempt ${(job.requeueCount ?? 0) + 1}/${MAX_IMPORT_REQUEUES})`,
      );
    }

    const staleProcessing = await this.jobModel
      .find({
        status: 'PROCESSING',
        startedAt: { $lt: new Date(now - STALE_PROCESSING_IMPORT_MS) },
      })
      .limit(20)
      .exec();
    for (const job of staleProcessing) {
      await this.jobModel
        .updateOne(
          { _id: job._id },
          {
            $set: {
              status: 'FAILED',
              error:
                'Import timed out while processing (worker crashed mid-run). Re-run it — re-imports are idempotent.',
              completedAt: new Date(),
            },
          },
        )
        .exec();
      this.logger.error(
        `Import ${String(job._id)} ("${job.filename}") marked FAILED: stale PROCESSING`,
      );
    }
  }
}
