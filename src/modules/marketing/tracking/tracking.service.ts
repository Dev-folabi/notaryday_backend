import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../schemas/campaign-recipient.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../schemas/suppression.schema';
import { EmailEvent, EmailEventDocument } from '../schemas/email-event.schema';

/** Public tracking endpoints: open pixel, click redirect, unsubscribe. */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
  ) {}

  private readonly DEDUP_WINDOW_MS = 2000;

  private async hasRecentEvent(
    recipientId: Types.ObjectId,
    type: 'OPENED' | 'CLICKED',
  ): Promise<boolean> {
    const since = new Date(Date.now() - this.DEDUP_WINDOW_MS);
    const existing = await this.eventModel
      .findOne({
        recipientRef: recipientId,
        type,
        createdAt: { $gte: since },
      })
      .select('_id')
      .exec();
    return !!existing;
  }

  /** Records an open and always resolves (never leaks recipient validity). */
  async recordOpen(recipientId: string) {
    const recipient = await this.findRecipient(recipientId);
    if (!recipient) return;

    if (await this.hasRecentEvent(recipient._id, 'OPENED')) return;

    const now = new Date();
    await this.recipientModel
      .updateOne(
        { _id: recipient._id },
        {
          $inc: { openCount: 1 },
          $push: { openedAt: now },
        },
      )
      .exec();
    if (recipient.leadRef) {
      await this.leadModel
        .updateOne(
          { _id: recipient.leadRef },
          { $inc: { openedCount: 1 }, $push: { openedAt: now } },
        )
        .exec();
    }
    await this.eventModel.create({
      campaignRef: recipient.campaignRef,
      recipientRef: recipient._id,
      leadRef: recipient.leadRef,
      email: recipient.email,
      type: 'OPENED',
      source: 'PIXEL',
    });
  }

  /** Records a click and returns the validated destination URL. */
  async recordClick(
    recipientId: string,
    target: string | undefined,
    fallbackUrl: string,
  ) {
    let url = target ?? '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('bad protocol');
      }
      url = parsed.toString();
    } catch {
      url = fallbackUrl;
    }

    const recipient = await this.findRecipient(recipientId);
    if (!recipient) return url;

    if (await this.hasRecentEvent(recipient._id, 'CLICKED')) return url;

    const now = new Date();
    await this.recipientModel
      .updateOne(
        { _id: recipient._id },
        {
          $inc: { clickCount: 1 },
          $push: { clickedAt: now },
        },
      )
      .exec();
    if (recipient.leadRef) {
      await this.leadModel
        .updateOne(
          { _id: recipient.leadRef },
          { $inc: { clickedCount: 1 }, $push: { clickedAt: now } },
        )
        .exec();
    }
    await this.eventModel.create({
      campaignRef: recipient.campaignRef,
      recipientRef: recipient._id,
      leadRef: recipient.leadRef,
      email: recipient.email,
      type: 'CLICKED',
      source: 'PIXEL',
      meta: { url },
    });
    return url;
  }

  /**
   * Applies an unsubscribe by token. Token resolution order:
   * lead.unsubToken → campaign_recipient.unsubToken (direct sends) →
   * existing suppression token. Idempotent.
   */
  async unsubscribe(token: string | undefined): Promise<boolean> {
    if (!token || token.length < 8) return false;

    const lead = await this.leadModel.findOne({ unsubToken: token }).exec();
    if (lead?.email) {
      await this.applyUnsub(lead.email, token, lead._id);
      return true;
    }

    const recipient = await this.recipientModel
      .findOne({ unsubToken: token })
      .exec();
    if (recipient?.email) {
      await this.applyUnsub(recipient.email, token, recipient.leadRef);
      return true;
    }

    const existing = await this.suppressionModel.findOne({ token }).exec();
    if (existing?.email) {
      await this.applyUnsub(existing.email, token, existing.leadRef);
      return true;
    }

    return false;
  }

  private async applyUnsub(
    email: string,
    token: string,
    leadRef?: Types.ObjectId | null,
  ) {
    await this.suppressionModel.updateOne(
      { email },
      {
        $set: {
          email,
          type: 'UNSUBSCRIBE',
          token,
          leadRef: leadRef ?? undefined,
        },
      },
      { upsert: true },
    );
    if (leadRef) {
      await this.leadModel
        .updateOne(
          { _id: leadRef },
          { $set: { status: 'UNSUBSCRIBED', unsubToken: token } },
        )
        .exec();
    }
    // Skip every queued send for this email across all campaigns
    await this.recipientModel
      .updateMany(
        { email, status: 'QUEUED' },
        { $set: { status: 'SKIPPED', skipReason: 'unsubscribed' } },
      )
      .exec();
    await this.eventModel.create({
      email,
      leadRef: leadRef ?? undefined,
      type: 'UNSUBSCRIBED',
      source: 'API',
    });
    this.logger.log(`Unsubscribed: ${email}`);
  }

  private async findRecipient(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.recipientModel.findById(id).exec();
  }
}
