import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import {
  Campaign,
  CampaignDocument,
} from '../../../modules/marketing/schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../../../modules/marketing/schemas/campaign-recipient.schema';
import {
  LeadMessage,
  LeadMessageDocument,
} from '../../../modules/marketing/schemas/lead-message.schema';
import {
  EmailProvider,
  EmailProviderDocument,
} from '../../../modules/marketing/schemas/provider.schema';
import { AudienceResolverService } from '../../../modules/marketing/campaigns/audience-resolver.service';
import {
  shiftToLocalMorning,
  stateTimeZone,
} from '../../../modules/marketing/campaigns/smart-time.util';

const INSERT_BATCH = 500;
const STUCK_DISPATCH_MS = 10 * 60_000;

/**
 * Dispatches SCHEDULED campaigns: resolves the audience, materializes
 * CampaignRecipient rows for every (lead, step) with paced sendAt times,
 * then flips the campaign to RUNNING. The send-tick cron takes over from
 * there. Also retries DISPATCHING campaigns stuck by a crash.
 */
@Injectable()
export class DispatchTickService {
  private readonly logger = new Logger(DispatchTickService.name);
  private dispatching = new Set<string>();

  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(LeadMessage.name)
    private readonly messageModel: Model<LeadMessageDocument>,
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
    private readonly resolver: AudienceResolverService,
  ) {}

  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    const now = new Date();

    const due = await this.campaignModel
      .find({
        status: { $in: ['SCHEDULED', 'DISPATCHING'] },
        'schedule.startAt': { $lte: now },
      })
      .limit(20)
      .exec();

    for (const campaign of due) {
      const id = String(campaign._id);
      if (this.dispatching.has(id)) continue;

      const stuck =
        campaign.status === 'DISPATCHING' &&
        campaign.dispatchStartedAt &&
        now.getTime() - new Date(campaign.dispatchStartedAt).getTime() >
          STUCK_DISPATCH_MS;
      if (campaign.status === 'DISPATCHING' && !stuck) continue;

      this.dispatching.add(id);
      try {
        await this.dispatch(campaign);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Dispatch failed for campaign ${id}: ${message}`);
        await this.campaignModel
          .updateOne(
            {
              _id: campaign._id,
              status: { $in: ['DISPATCHING', 'SCHEDULED'] },
            },
            {
              $set: {
                status: 'FAILED',
                error: message.slice(0, 1000),
                completedAt: new Date(),
              },
            },
          )
          .exec();
      } finally {
        this.dispatching.delete(id);
      }
    }
  }

  private async dispatch(campaign: CampaignDocument): Promise<void> {
    const campaignId = campaign._id;

    await this.campaignModel
      .updateOne(
        { _id: campaignId },
        { $set: { status: 'DISPATCHING', dispatchStartedAt: new Date() } },
      )
      .exec();

    // Idempotency: a crashed dispatch may have created some recipients —
    // drop partials and rebuild.
    await this.recipientModel
      .deleteMany({
        campaignRef: campaignId,
        status: { $in: ['QUEUED', 'SENDING'] },
      })
      .exec();

    const provider = await this.providerModel
      .findById(campaign.providerRef)
      .exec();
    if (!provider) {
      throw new Error('Provider no longer exists');
    }
    if (provider.status !== 'ACTIVE') {
      // Delay the whole campaign until the provider is reactivated
      await this.campaignModel
        .updateOne(
          { _id: campaignId },
          {
            $set: {
              status: 'SCHEDULED',
              'schedule.startAt': new Date(Date.now() + 15 * 60_000),
            },
          },
        )
        .exec();
      this.logger.warn(
        `Campaign ${String(campaignId)} delayed: provider "${provider.name}" is ${provider.status}`,
      );
      return;
    }

    const perMinute = Math.min(
      (campaign.schedule as { perMinute: number }).perMinute,
      provider.perMinuteLimit,
    );
    const smartSendTimes = (campaign.schedule as { smartSendTimes: boolean })
      .smartSendTimes;
    const startAt = new Date((campaign.schedule as { startAt: Date }).startAt);

    // USERS (re-engagement) audience: recipients from the snapshot emails
    if ((campaign.audience as { mode?: string }).mode === 'USERS') {
      const emails = (
        (campaign.audience as { emails?: string[] }).emails ?? []
      ).filter(Boolean);
      if (emails.length === 0) {
        await this.campaignModel
          .updateOne(
            { _id: campaignId },
            {
              $set: {
                status: 'FAILED',
                error: 'User audience snapshot is empty',
                completedAt: new Date(),
              },
            },
          )
          .exec();
        return;
      }
      const userDocs: Record<string, unknown>[] = [];
      emails.forEach((email, index) => {
        const paced =
          startAt.getTime() + Math.floor(index / perMinute) * 60_000;
        userDocs.push({
          campaignRef: campaignId,
          leadRef: undefined,
          step: 1,
          email,
          status: 'QUEUED',
          campaignStatus: 'RUNNING',
          providerRef: provider._id,
          sendAt: new Date(paced),
          unsubToken: randomBytes(12).toString('hex'),
          leadName: email,
        });
      });
      for (let i = 0; i < userDocs.length; i += INSERT_BATCH) {
        await this.recipientModel.insertMany(
          userDocs.slice(i, i + INSERT_BATCH),
          { ordered: false },
        );
      }
      await this.campaignModel
        .updateOne(
          { _id: campaignId },
          { $set: { status: 'RUNNING', error: null } },
        )
        .exec();
      this.logger.log(
        `Campaign "${campaign.name}" dispatched: ${userDocs.length} user recipients (${perMinute}/min)`,
      );
      return;
    }

    const steps =
      campaign.type === 'SEQUENCE'
        ? (campaign.content.steps ?? [1, 2, 3, 4, 5, 6, 7, 8, 9])
        : [campaign.content.step ?? 1];

    const leads = await this.resolver.resolveSendable(campaign.audience);
    if (leads.length === 0) {
      await this.campaignModel
        .updateOne(
          { _id: campaignId },
          {
            $set: {
              status: 'FAILED',
              error: 'No sendable leads in audience at dispatch time',
              completedAt: new Date(),
            },
          },
        )
        .exec();
      return;
    }

    // Which (lead, step) pairs have drafts (LEAD_DRAFTS mode)
    const draftMap = new Set<string>();
    if (campaign.content.mode === 'LEAD_DRAFTS') {
      const leadIds = leads.map((l) => l._id);
      for (let i = 0; i < leadIds.length; i += 1000) {
        const chunk = leadIds.slice(i, i + 1000);
        const messages = await this.messageModel
          .find({ leadRef: { $in: chunk }, step: { $in: steps } })
          .select('leadRef step')
          .lean<{ leadRef: Types.ObjectId; step: number }[]>()
          .exec();
        for (const m of messages)
          draftMap.add(`${String(m.leadRef)}:${m.step}`);
      }
    }

    const docs: Record<string, unknown>[] = [];
    for (const step of steps) {
      const dayOffset = campaign.type === 'SEQUENCE' ? (step - 1) * 2 : 0;
      const base = startAt.getTime() + dayOffset * 86_400_000;

      let index = 0;
      for (const lead of leads) {
        if (
          campaign.content.mode === 'LEAD_DRAFTS' &&
          !draftMap.has(`${String(lead._id)}:${step}`)
        ) {
          continue;
        }
        const paced = base + Math.floor(index / perMinute) * 60_000;
        const sendAt = smartSendTimes
          ? shiftToLocalMorning(
              new Date(paced),
              stateTimeZone(lead.state),
              (index % 180) / 180,
            )
          : new Date(paced);
        docs.push({
          campaignRef: campaignId,
          leadRef: lead._id,
          step,
          email: lead.email,
          status: 'QUEUED',
          campaignStatus: 'RUNNING',
          providerRef: provider._id,
          sendAt,
          unsubToken: lead.unsubToken,
          leadName: lead.businessName,
          abGroup: lead.abGroup,
        });
        index++;
      }
    }

    for (let i = 0; i < docs.length; i += INSERT_BATCH) {
      await this.recipientModel.insertMany(docs.slice(i, i + INSERT_BATCH), {
        ordered: false,
      });
    }

    await this.campaignModel
      .updateOne(
        { _id: campaignId },
        { $set: { status: 'RUNNING', error: null } },
      )
      .exec();

    this.logger.log(
      `Campaign "${campaign.name}" dispatched: ${docs.length} recipients ` +
        `(${leads.length} leads × steps ${steps.join(',')}, ${perMinute}/min${smartSendTimes ? ', smart send times' : ''})`,
    );
  }
}
