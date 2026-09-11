import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QUEUE_MARKETING } from '../../../queues/queue.constants';
import {
  EmailProvider,
  EmailProviderDocument,
} from '../../../modules/marketing/schemas/provider.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../../../modules/marketing/schemas/campaign-recipient.schema';
import { effectiveDailyLimit } from '../services/send-email.service';

const CLAIM_BATCH = 100;

/**
 * The pacing engine. Every 15s, for each ACTIVE provider:
 *  1. roll over the sent-today counter,
 *  2. count sends claimed/completed in the last 60s,
 *  3. claim due QUEUED recipients (QUEUED -> SENDING, atomic) up to the
 *     remaining per-minute budget and enqueue send-email jobs.
 * Daily caps (incl. warmup ramps) stop claims for the rest of the day.
 */
@Injectable()
export class SendTickService {
  private readonly logger = new Logger(SendTickService.name);
  private busy = false;

  constructor(
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectQueue(QUEUE_MARKETING) private readonly marketingQueue: Queue,
  ) {}

  @Cron('*/15 * * * * *')
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.tickInternal();
    } catch (error) {
      this.logger.error(
        `send-tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.busy = false;
    }
  }

  private async tickInternal(): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const providers = await this.providerModel
      .find({ status: 'ACTIVE' })
      .exec();
    if (providers.length === 0) return;

    for (const provider of providers) {
      // Daily rollover
      if (provider.sentTodayDate !== today) {
        await this.providerModel
          .updateOne(
            { _id: provider._id },
            { $set: { sentToday: 0, sentTodayDate: today } },
          )
          .exec();
        provider.sentToday = 0;
        provider.sentTodayDate = today;
      }

      if ((provider.sentToday ?? 0) >= effectiveDailyLimit(provider)) {
        continue; // out of budget for today
      }

      // Per-minute pacing window
      const windowStart = new Date(now.getTime() - 60_000);
      const recent = await this.recipientModel
        .countDocuments({
          providerRef: provider._id,
          status: { $in: ['SENDING', 'SENT'] },
          $or: [
            { sentAt: { $gte: windowStart } },
            { claimedAt: { $gte: windowStart } },
          ],
        })
        .exec();
      const remaining = provider.perMinuteLimit - recent;
      if (remaining <= 0) continue;

      const due = await this.recipientModel
        .find({
          status: 'QUEUED',
          campaignStatus: 'RUNNING',
          sendAt: { $lte: now },
          providerRef: provider._id,
        })
        .sort({ sendAt: 1 })
        .limit(Math.min(remaining, CLAIM_BATCH))
        .select('_id')
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      for (const row of due) {
        // The atomic QUEUED→SENDING claim IS the dedupe (a recipient can
        // only be claimed once), so no Bull jobId — reusing a jobId that a
        // retained failed job already owns would silently drop the add.
        const claimed = await this.recipientModel
          .findOneAndUpdate(
            { _id: row._id, status: 'QUEUED' },
            { $set: { status: 'SENDING', claimedAt: new Date() } },
            { returnDocument: 'after' },
          )
          .exec();
        if (!claimed) continue; // someone else claimed it
        await Promise.race([
          this.marketingQueue.add('send-email', {
            recipientId: String(claimed._id),
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]).catch((error) => {
          this.logger.warn(
            `Failed to enqueue send for ${String(claimed._id)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }
  }
}
