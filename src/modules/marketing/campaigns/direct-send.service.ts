import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { Campaign, CampaignDocument } from '../schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../schemas/campaign-recipient.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  EmailProvider,
  EmailProviderDocument,
} from '../schemas/provider.schema';
import { PrismaService } from '../../../config/prisma.service';
import { DirectSendDto } from '../dto/campaign.dto';

/**
 * Direct one-off emails to a lead, a platform user, or a raw address.
 * Runs through the same pipeline as campaigns (recipient row, tracking,
 * unsubscribe) as a hidden DIRECT campaign.
 */
@Injectable()
export class DirectSendService {
  private readonly logger = new Logger(DirectSendService.name);

  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
    private readonly prisma: PrismaService,
  ) {}

  async send(dto: DirectSendDto, userId: string) {
    const { email, leadRef, leadName, unsubToken } =
      await this.resolveTarget(dto);

    const provider = await this.resolveProvider(dto.providerId);

    const campaign = await this.campaignModel.create({
      name: `Direct → ${leadName ?? email}`,
      type: 'DIRECT',
      providerRef: provider._id,
      status: 'RUNNING',
      audience: { mode: 'IDS', filters: {}, leadIds: [], excludeLeadIds: [] },
      content: {
        mode: 'TEMPLATE',
        subject: dto.subject,
        body: dto.body,
      },
      schedule: {
        startAt: new Date(),
        perMinute: 1,
        smartSendTimes: false,
      },
      stopOnReply: false,
      createdBy: Types.ObjectId.isValid(userId)
        ? new Types.ObjectId(userId)
        : undefined,
    });

    const recipient = await this.recipientModel.create({
      campaignRef: campaign._id,
      leadRef,
      step: 1,
      email,
      status: 'QUEUED',
      campaignStatus: 'RUNNING',
      providerRef: provider._id,
      sendAt: dto.scheduleAt ? new Date(dto.scheduleAt) : new Date(),
      unsubToken,
      leadName: leadName ?? email,
    });

    this.logger.log(
      `Direct email queued: ${email} via ${provider.name} (campaign ${String(campaign._id)})`,
    );

    return {
      campaignId: String(campaign._id),
      recipientId: String(recipient._id),
      email,
      provider: provider.name,
      sendAt: recipient.sendAt,
    };
  }

  private async resolveTarget(dto: DirectSendDto): Promise<{
    email: string;
    leadRef?: Types.ObjectId;
    leadName?: string;
    unsubToken: string;
  }> {
    if (dto.targetType === 'LEAD') {
      if (!dto.leadId || !Types.ObjectId.isValid(dto.leadId)) {
        throw new BadRequestException('leadId is required for LEAD targets');
      }
      const lead = await this.leadModel.findById(dto.leadId).exec();
      if (!lead) throw new NotFoundException('Lead not found');
      if (!lead.email) {
        throw new BadRequestException('This lead has no email address');
      }
      if (!lead.unsubToken) {
        const token = randomBytes(12).toString('hex');
        await this.leadModel
          .updateOne({ _id: lead._id }, { $set: { unsubToken: token } })
          .exec();
        lead.unsubToken = token;
      }
      return {
        email: lead.email,
        leadRef: lead._id,
        leadName: lead.businessName ?? undefined,
        unsubToken: lead.unsubToken,
      };
    }

    if (dto.targetType === 'USER') {
      if (!dto.userId) {
        throw new BadRequestException('userId is required for USER targets');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { email: true, full_name: true, username: true },
      });
      if (!user) throw new NotFoundException('User not found');
      // Reuse the lead unsubscribe token when this email maps to a CRM lead
      const lead = await this.leadModel
        .findOne({ email: user.email.toLowerCase() })
        .exec();
      if (lead?.unsubToken) {
        return {
          email: user.email,
          leadRef: lead._id,
          leadName: lead.businessName ?? user.full_name ?? undefined,
          unsubToken: lead.unsubToken,
        };
      }
      return {
        email: user.email,
        leadName: user.full_name ?? user.username ?? undefined,
        unsubToken: randomBytes(12).toString('hex'),
      };
    }

    if (!dto.email) {
      throw new BadRequestException('email is required for EMAIL targets');
    }
    const email = dto.email.trim().toLowerCase();
    const lead = await this.leadModel.findOne({ email }).exec();
    if (lead?.unsubToken) {
      return {
        email,
        leadRef: lead._id,
        leadName: lead.businessName ?? undefined,
        unsubToken: lead.unsubToken,
      };
    }
    return { email, unsubToken: randomBytes(12).toString('hex') };
  }

  private async resolveProvider(providerId?: string) {
    if (providerId) {
      if (!Types.ObjectId.isValid(providerId)) {
        throw new BadRequestException('Invalid providerId');
      }
      const provider = await this.providerModel.findById(providerId).exec();
      if (!provider) throw new NotFoundException('Provider not found');
      if (provider.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Provider "${provider.name}" is ${provider.status}`,
        );
      }
      return provider;
    }
    const provider =
      (await this.providerModel
        .findOne({ isDefault: true, status: 'ACTIVE' })
        .exec()) ??
      (await this.providerModel.findOne({ status: 'ACTIVE' }).exec());
    if (!provider) {
      throw new BadRequestException(
        'No active email provider — configure one in Marketing → Providers',
      );
    }
    return provider;
  }
}
