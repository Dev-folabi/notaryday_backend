import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../../../modules/marketing/schemas/campaign-recipient.schema';
import {
  Lead,
  LeadDocument,
} from '../../../modules/marketing/schemas/lead.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../../../modules/marketing/schemas/suppression.schema';
import {
  EmailEvent,
  EmailEventDocument,
} from '../../../modules/marketing/schemas/email-event.schema';
import type { NormalizedWebhookEvent } from '../../../modules/marketing/webhooks/webhooks.controller';

/**
 * Processes provider webhook events: recipient/lead status updates,
 * suppression creation for bounces & complaints, engagement counters.
 */
@Injectable()
export class WebhookEventService {
  private readonly logger = new Logger(WebhookEventService.name);
  private readonly DEDUP_WINDOW_MS = 2000;

  constructor(
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
  ) {}

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

  async process(event: NormalizedWebhookEvent): Promise<void> {
    const recipient = await this.resolveRecipient(event);
    if (!recipient) {
      // Log event even when no recipient is found (for audit trail)
      await this.eventModel.create({
        email: event.email,
        type: event.type,
        provider: event.provider,
        providerMessageId: event.messageId,
        source: 'WEBHOOK',
        meta: { reason: event.reason, link: event.link, hard: event.hard },
      });
      return;
    }

    switch (event.type) {
      case 'OPENED': {
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
        break;
      }
      case 'CLICKED': {
        if (await this.hasRecentEvent(recipient._id, 'CLICKED')) return;
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
        break;
      }
      case 'BOUNCED': {
        await this.recipientModel
          .updateOne(
            { _id: recipient._id },
            {
              $set: {
                status: 'BOUNCED',
                error: event.reason ?? 'bounced',
                claimedAt: null,
              },
            },
          )
          .exec();
        if (event.hard !== false && recipient.email) {
          // hard bounce (or unknown) → suppress
          await this.suppress(
            recipient.email,
            'BOUNCE',
            event.reason,
            recipient.leadRef,
          );
          if (recipient.leadRef) {
            await this.leadModel
              .updateOne(
                { _id: recipient.leadRef },
                { $set: { status: 'BOUNCED' } },
              )
              .exec();
          }
          await this.skipQueued(recipient.email, 'bounced');
        }
        break;
      }
      case 'COMPLAINED': {
        await this.recipientModel
          .updateOne(
            { _id: recipient._id },
            { $set: { status: 'COMPLAINED', claimedAt: null } },
          )
          .exec();
        if (recipient.email) {
          await this.suppress(
            recipient.email,
            'COMPLAINT',
            event.reason ?? 'spam complaint',
            recipient.leadRef,
          );
          if (recipient.leadRef) {
            await this.leadModel
              .updateOne(
                { _id: recipient.leadRef },
                { $set: { status: 'UNSUBSCRIBED' } },
              )
              .exec();
          }
          await this.skipQueued(recipient.email, 'complained');
        }
        break;
      }
      case 'UNSUBSCRIBED': {
        await this.recipientModel
          .updateOne(
            { _id: recipient._id },
            { $set: { status: 'UNSUBSCRIBED', claimedAt: null } },
          )
          .exec();
        if (recipient.email) {
          await this.suppress(
            recipient.email,
            'UNSUBSCRIBE',
            'brevo unsubscribe',
            recipient.leadRef,
          );
          if (recipient.leadRef) {
            await this.leadModel
              .updateOne(
                { _id: recipient.leadRef },
                { $set: { status: 'UNSUBSCRIBED' } },
              )
              .exec();
          }
          await this.skipQueued(recipient.email, 'unsubscribed');
        }
        break;
      }
      case 'DELIVERED':
      default:
        break;
    }

    // Create email_events record AFTER counter updates so dedup check
    // doesn't immediately find this record and skip the increment.
    await this.eventModel.create({
      campaignRef: recipient.campaignRef,
      recipientRef: recipient._id,
      leadRef: recipient.leadRef,
      email: event.email ?? recipient.email,
      type: event.type,
      provider: event.provider,
      providerMessageId: event.messageId,
      source: 'WEBHOOK',
      meta: { reason: event.reason, link: event.link, hard: event.hard },
    });
  }

  private async resolveRecipient(
    event: NormalizedWebhookEvent,
  ): Promise<CampaignRecipientDocument | null> {
    if (event.messageId) {
      const byMessageId = await this.recipientModel
        .findOne({ providerMessageId: event.messageId })
        .exec();
      if (byMessageId) return byMessageId;
    }
    if (event.email) {
      // Fallback: most recent SENT recipient for this address
      return this.recipientModel
        .findOne({
          email: event.email.toLowerCase(),
          status: { $in: ['SENT', 'BOUNCED', 'COMPLAINED'] },
        })
        .sort({ sentAt: -1 })
        .exec();
    }
    return null;
  }

  private async suppress(
    email: string,
    type: string,
    reason?: string,
    leadRef?: unknown,
  ) {
    await this.suppressionModel.updateOne(
      { email },
      { $set: { email, type, reason, leadRef: leadRef ?? undefined } },
      { upsert: true },
    );
  }

  private async skipQueued(email: string, reason: string) {
    await this.recipientModel
      .updateMany(
        { email, status: 'QUEUED' },
        { $set: { status: 'SKIPPED', skipReason: reason } },
      )
      .exec();
    this.logger.log(`Suppressed ${email} (${reason}); queued sends skipped`);
  }
}
