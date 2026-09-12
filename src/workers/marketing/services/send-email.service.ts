import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  Lead,
  LeadDocument,
} from '../../../modules/marketing/schemas/lead.schema';
import {
  LeadMessage,
  LeadMessageDocument,
} from '../../../modules/marketing/schemas/lead-message.schema';
import {
  EmailProvider,
  EmailProviderDocument,
} from '../../../modules/marketing/schemas/provider.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../../../modules/marketing/schemas/suppression.schema';
import {
  EmailEvent,
  EmailEventDocument,
} from '../../../modules/marketing/schemas/email-event.schema';
import { EncryptionService } from '../../../modules/marketing/encryption/encryption.service';
import { MailerFactory } from '../../../modules/marketing/mailer/mailer.factory';
import {
  WARMUP_BASE_DAILY,
  WARMUP_DAILY_STEP,
} from '../../../modules/marketing/marketing.constants';
import {
  composeMarketingEmail,
  renderTemplate,
} from '../../../modules/marketing/campaigns/email-compose.util';

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Effective daily limit, honoring the warmup ramp when enabled. */
export function effectiveDailyLimit(provider: {
  warmupEnabled: boolean;
  warmupStartedAt?: Date | null;
  dailyLimit: number;
}): number {
  if (!provider.warmupEnabled || !provider.warmupStartedAt) {
    return provider.dailyLimit;
  }
  const days = Math.floor(
    (Date.now() - new Date(provider.warmupStartedAt).getTime()) / 86_400_000,
  );
  return Math.min(
    provider.dailyLimit,
    WARMUP_BASE_DAILY + Math.max(0, days) * WARMUP_DAILY_STEP,
  );
}

/**
 * Sends a single claimed campaign recipient. All pre-send gates are
 * re-checked here (suppression, exclusion, reply-stop, campaign status,
 * provider budget) so pause/cancel/unsubscribe take effect immediately.
 */
@Injectable()
export class SendEmailService {
  private readonly logger = new Logger(SendEmailService.name);

  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadMessage.name)
    private readonly messageModel: Model<LeadMessageDocument>,
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
    private readonly encryption: EncryptionService,
    private readonly mailerFactory: MailerFactory,
    private readonly config: ConfigService,
  ) {}

  async send(recipientId: string, isFinalAttempt: boolean): Promise<void> {
    const recipient = await this.recipientModel.findById(recipientId).exec();
    if (!recipient) return;
    if (recipient.status !== 'SENDING') return; // cancelled/requeued elsewhere

    const campaign = await this.campaignModel
      .findById(recipient.campaignRef)
      .exec();
    if (!campaign || campaign.status !== 'RUNNING') {
      await this.skip(recipient, campaign?.status ?? 'missing campaign');
      return;
    }

    const lead = recipient.leadRef
      ? await this.leadModel.findById(recipient.leadRef).exec()
      : recipient.email
        ? // USERS-audience recipients carry no leadRef — resolve by email
          // so template variables can still personalize.
          await this.leadModel.findOne({ email: recipient.email }).exec()
        : null;

    // Suppression (race-safe: checked again at send time)
    if (recipient.email) {
      const suppressed = await this.suppressionModel
        .findOne({ email: recipient.email })
        .lean<{ type?: string }>()
        .exec();
      if (suppressed) {
        await this.skip(
          recipient,
          `suppressed (${suppressed.type ?? 'unknown'})`,
        );
        if (lead && lead.status !== 'UNSUBSCRIBED') {
          await this.leadModel
            .updateOne({ _id: lead._id }, { $set: { status: 'UNSUBSCRIBED' } })
            .exec();
        }
        return;
      }
    }
    if (lead?.excludeFromSend) {
      await this.skip(recipient, 'lead excluded');
      return;
    }
    if (campaign.stopOnReply && lead?.status === 'REPLIED') {
      await this.skip(recipient, 'lead replied (stop-on-reply)');
      return;
    }

    // Provider + daily budget
    const provider = await this.providerModel
      .findById(recipient.providerRef)
      .exec();
    if (!provider) {
      await this.fail(recipient, 'provider no longer exists', campaign._id);
      return;
    }
    if (provider.status !== 'ACTIVE') {
      await this.reschedule(recipient, 15 * 60_000, 'provider paused');
      return;
    }
    const today = utcDateKey(new Date());
    const sentToday =
      provider.sentTodayDate === today ? (provider.sentToday ?? 0) : 0;
    if (sentToday >= effectiveDailyLimit(provider)) {
      await this.rescheduleToNextDay(recipient);
      return;
    }

    // Resolve content
    let subject: string;
    let body: string;
    if (campaign.content.mode === 'TEMPLATE') {
      subject = renderTemplate(campaign.content.subject ?? '', lead);
      body = renderTemplate(campaign.content.body ?? '', lead);
    } else {
      const message = recipient.leadRef
        ? await this.messageModel
            .findOne({ leadRef: recipient.leadRef, step: recipient.step })
            .exec()
        : null;
      if (!message?.body) {
        await this.skip(recipient, `no draft for step ${recipient.step}`);
        return;
      }
      subject =
        message.subject ||
        lead?.emailSubject ||
        'A quick note about your notary day';
      body = message.body;
    }

    const composed = composeMarketingEmail({
      subject,
      textBody: body,
      recipientId: String(recipient._id),
      unsubToken: recipient.unsubToken ?? lead?.unsubToken ?? '',
      publicBaseUrl: this.config.get<string>('marketing.publicBaseUrl', {
        infer: true,
      })!,
      physicalAddress: this.config.get<string>('marketing.physicalAddress', {
        infer: true,
      }),
    });

    try {
      const credentials = this.encryption.decrypt<Record<string, string>>(
        provider.credentialsEncrypted,
      );
      const mailer = this.mailerFactory.build(
        provider.type as never,
        credentials,
      );
      const result = await mailer.send({
        to: recipient.email,
        subject: composed.subject,
        html: composed.html,
        text: composed.text,
        fromName: provider.fromName,
        fromEmail: provider.fromEmail,
        replyTo: provider.replyTo ?? undefined,
        headers: composed.headers,
        tags: [String(campaign._id)],
      });

      const now = new Date();
      await this.recipientModel
        .updateOne(
          { _id: recipient._id },
          {
            $set: {
              status: 'SENT',
              sentAt: now,
              providerMessageId: result.providerMessageId,
              subject: composed.subject,
              error: null,
            },
          },
        )
        .exec();
      await this.providerModel
        .updateOne(
          { _id: provider._id },
          {
            $set: {
              sentToday: sentToday + 1,
              sentTodayDate: today,
              healthLastSuccessAt: now,
              healthLastError: null,
              healthLastErrorAt: null,
            },
          },
        )
        .exec();
      if (lead) {
        const nextStatus =
          lead.status === 'REPLIED' || lead.status === 'CONVERTED'
            ? lead.status
            : campaign.type === 'SEQUENCE'
              ? 'IN_SEQUENCE'
              : 'CONTACTED';
        await this.leadModel
          .updateOne(
            { _id: lead._id },
            {
              $inc: { emailsSent: 1 },
              $set: { lastContactedAt: now, status: nextStatus },
            },
          )
          .exec();
      }
      await this.eventModel.create({
        campaignRef: campaign._id,
        recipientRef: recipient._id,
        leadRef: recipient.leadRef,
        email: recipient.email,
        type: 'SENT',
        provider: provider.type,
        providerMessageId: result.providerMessageId,
        source: 'SEND',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.providerModel
        .updateOne(
          { _id: provider._id },
          {
            $set: {
              healthLastError: message.slice(0, 500),
              healthLastErrorAt: new Date(),
            },
          },
        )
        .exec();
      if (isFinalAttempt) {
        await this.fail(recipient, message, campaign._id, provider.type);
      } else {
        // Let Bull retry with backoff; recipient stays SENDING
        this.logger.warn(
          `Send failed for ${recipient.email} (will retry): ${message}`,
        );
        throw error;
      }
    }
  }

  private async skip(recipient: CampaignRecipientDocument, reason: string) {
    await this.recipientModel
      .updateOne(
        { _id: recipient._id },
        { $set: { status: 'SKIPPED', skipReason: reason, claimedAt: null } },
      )
      .exec();
    await this.eventModel.create({
      campaignRef: recipient.campaignRef,
      recipientRef: recipient._id,
      leadRef: recipient.leadRef,
      email: recipient.email,
      type: 'SKIPPED',
      source: 'SEND',
      meta: { reason },
    });
  }

  private async fail(
    recipient: CampaignRecipientDocument,
    error: string,
    campaignRef: CampaignRecipientDocument['campaignRef'],
    providerType?: string,
  ) {
    await this.recipientModel
      .updateOne(
        { _id: recipient._id },
        {
          $set: {
            status: 'FAILED',
            error: error.slice(0, 500),
            claimedAt: null,
          },
        },
      )
      .exec();
    await this.eventModel.create({
      campaignRef: recipient.campaignRef,
      recipientRef: recipient._id,
      leadRef: recipient.leadRef,
      email: recipient.email,
      type: 'FAILED',
      provider: providerType,
      source: 'SEND',
      meta: { error: error.slice(0, 500) },
    });
    void campaignRef;
  }

  private async reschedule(
    recipient: CampaignRecipientDocument,
    delayMs: number,
    reason: string,
  ) {
    await this.recipientModel
      .updateOne(
        { _id: recipient._id },
        {
          $set: {
            status: 'QUEUED',
            claimedAt: null,
            sendAt: new Date(Date.now() + delayMs),
          },
        },
      )
      .exec();
    this.logger.log(
      `Rescheduled ${recipient.email} +${Math.round(delayMs / 60000)}min (${reason})`,
    );
  }

  private async rescheduleToNextDay(recipient: CampaignRecipientDocument) {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        5,
      ),
    );
    await this.recipientModel
      .updateOne(
        { _id: recipient._id },
        { $set: { status: 'QUEUED', claimedAt: null, sendAt: next } },
      )
      .exec();
    this.logger.log(
      `Daily provider limit reached; ${recipient.email} moved to ${next.toISOString()}`,
    );
  }
}
