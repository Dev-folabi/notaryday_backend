import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Suppression,
  SuppressionDocument,
} from '../schemas/suppression.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../schemas/campaign-recipient.schema';
import { EmailEvent, EmailEventDocument } from '../schemas/email-event.schema';

@Injectable()
export class SuppressService {
  constructor(
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
  ) {}

  async list(filters: {
    search?: string;
    type?: string;
    page: number;
    limit: number;
  }) {
    const query: Record<string, unknown> = {};
    if (filters.type) query.type = filters.type;
    if (filters.search) {
      query.email = new RegExp(
        filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
    }
    const page = Math.max(1, filters.page);
    const limit = Math.min(200, Math.max(1, filters.limit));
    const total = await this.suppressionModel.countDocuments(query);
    const data = await this.suppressionModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async create(dto: { email: string; type?: string; reason?: string }) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.suppressionModel.findOne({ email }).exec();
    if (existing) {
      throw new BadRequestException(
        `${email} is already on the suppression list (${existing.type})`,
      );
    }
    const lead = await this.leadModel.findOne({ email }).exec();
    const suppression = await this.suppressionModel.create({
      email,
      type: dto.type ?? 'MANUAL',
      reason: dto.reason,
      leadRef: lead?._id,
    });
    if (lead) {
      await this.leadModel
        .updateOne({ _id: lead._id }, { $set: { status: 'UNSUBSCRIBED' } })
        .exec();
    }
    return suppression;
  }

  /** Removes a suppression (re-subscribe) and unblocks queued sends. */
  async remove(id: string): Promise<{ removed: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Suppression not found');
    }
    const suppression = await this.suppressionModel
      .findByIdAndDelete(id)
      .exec();
    if (!suppression) throw new NotFoundException('Suppression not found');

    if (suppression.email) {
      const lead = await this.leadModel
        .findOne({ email: suppression.email })
        .exec();
      if (lead && ['UNSUBSCRIBED', 'BOUNCED'].includes(lead.status ?? '')) {
        await this.leadModel
          .updateOne(
            { _id: lead._id },
            {
              $set: {
                status: (lead.emailsSent ?? 0) > 0 ? 'CONTACTED' : 'NEW',
              },
            },
          )
          .exec();
      }
    }
    return { removed: true };
  }

  /** Applies an unsubscribe: suppression row + lead status + skip queued sends. */
  async applyUnsubscribe(params: {
    email: string;
    token?: string;
    leadRef?: Types.ObjectId | null;
    source?: string;
    reason?: string;
  }) {
    const email = params.email.trim().toLowerCase();
    await this.suppressionModel.updateOne(
      { email },
      {
        $set: {
          email,
          type: 'UNSUBSCRIBE',
          token: params.token,
          leadRef: params.leadRef ?? undefined,
          reason: params.reason,
        },
      },
      { upsert: true },
    );

    const lead = await this.leadModel.findOne({ email }).exec();
    if (lead) {
      await this.leadModel
        .updateOne(
          { _id: lead._id },
          {
            $set: {
              status: 'UNSUBSCRIBED',
              unsubToken: params.token ?? lead.unsubToken,
            },
          },
        )
        .exec();
    }

    // Skip every queued send for this email across all running campaigns
    await this.recipientModel
      .updateMany(
        { email, status: 'QUEUED' },
        { $set: { status: 'SKIPPED', skipReason: 'unsubscribed' } },
      )
      .exec();

    await this.eventModel.create({
      email,
      leadRef: params.leadRef ?? lead?._id,
      type: 'UNSUBSCRIBED',
      source: params.source ?? 'API',
    });

    return lead;
  }
}
