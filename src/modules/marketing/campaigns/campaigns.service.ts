import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignDocument } from '../schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../schemas/campaign-recipient.schema';
import {
  EmailProvider,
  EmailProviderDocument,
} from '../schemas/provider.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../schemas/suppression.schema';
import { PrismaService } from '../../../config/prisma.service';
import {
  AudienceResolverService,
  AudiencePreview,
} from './audience-resolver.service';
import { CreateCampaignDto, UpdateCampaignDto } from '../dto/campaign.dto';

export interface UserAudiencePreview {
  total: number;
  sendable: number;
  suppressed: number;
}

export interface CampaignListRow {
  campaign: Record<string, unknown>;
  stats: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    queued: number;
    sending: number;
    opened: number;
    clicked: number;
  };
}

export interface CampaignDetail {
  campaign: Record<string, unknown>;
  provider?: Record<string, unknown> | null;
  stats: {
    total: number;
    byStatus: Record<string, number>;
    opened: number;
    clicked: number;
    byStep: {
      step: number;
      total: number;
      sent: number;
      failed: number;
      skipped: number;
      opened: number;
    }[];
  };
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
    private readonly resolver: AudienceResolverService,
    private readonly prisma: PrismaService,
  ) {}

  private toPlain(doc: CampaignDocument): Record<string, unknown> {
    return doc.toObject() as unknown as Record<string, unknown>;
  }

  async list(): Promise<CampaignListRow[]> {
    const campaigns = await this.campaignModel
      .find()
      .sort({ createdAt: -1 })
      .limit(200)
      .exec();
    if (campaigns.length === 0) return [];

    const ids = campaigns.map((c) => c._id);
    const grouped = await this.recipientModel.aggregate<{
      _id: Types.ObjectId;
      total: number;
      sent: number;
      failed: number;
      skipped: number;
      queued: number;
      sending: number;
      opened: number;
      clicked: number;
    }>([
      { $match: { campaignRef: { $in: ids } } },
      {
        $group: {
          _id: '$campaignRef',
          total: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
          skipped: {
            $sum: {
              $cond: [{ $in: ['$status', ['SKIPPED', 'CANCELLED']] }, 1, 0],
            },
          },
          queued: { $sum: { $cond: [{ $eq: ['$status', 'QUEUED'] }, 1, 0] } },
          sending: { $sum: { $cond: [{ $eq: ['$status', 'SENDING'] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $gt: ['$clickCount', 0] }, 1, 0] } },
        },
      },
    ]);
    const statsById = new Map(grouped.map((g) => [String(g._id), g]));

    return campaigns.map((campaign) => {
      const g = statsById.get(String(campaign._id));
      return {
        campaign: this.toPlain(campaign),
        stats: {
          total: g?.total ?? 0,
          sent: g?.sent ?? 0,
          failed: g?.failed ?? 0,
          skipped: g?.skipped ?? 0,
          queued: g?.queued ?? 0,
          sending: g?.sending ?? 0,
          opened: g?.opened ?? 0,
          clicked: g?.clicked ?? 0,
        },
      };
    });
  }

  async detail(id: string): Promise<CampaignDetail> {
    const campaign = await this.findCampaignOrThrow(id);
    const provider = await this.providerModel
      .findById(campaign.providerRef)
      .select(
        'name type fromName fromEmail status isDefault sentToday dailyLimit',
      )
      .exec();

    const [byStatusRows, byStepRows] = await Promise.all([
      this.recipientModel.aggregate<{ _id: string; count: number }>([
        { $match: { campaignRef: campaign._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.recipientModel.aggregate<{
        _id: number;
        total: number;
        sent: number;
        failed: number;
        skipped: number;
        opened: number;
      }>([
        { $match: { campaignRef: campaign._id } },
        {
          $group: {
            _id: '$step',
            total: { $sum: 1 },
            sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
            skipped: {
              $sum: {
                $cond: [{ $in: ['$status', ['SKIPPED', 'CANCELLED']] }, 1, 0],
              },
            },
            opened: { $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of byStatusRows) {
      byStatus[row._id] = row.count;
      total += row.count;
    }
    const openedCount = await this.recipientModel.countDocuments({
      campaignRef: campaign._id,
      openCount: { $gt: 0 },
    });
    const clickedCount = await this.recipientModel.countDocuments({
      campaignRef: campaign._id,
      clickCount: { $gt: 0 },
    });

    return {
      campaign: this.toPlain(campaign),
      provider: provider
        ? (provider.toObject() as unknown as Record<string, unknown>)
        : null,
      stats: {
        total,
        byStatus,
        opened: openedCount,
        clicked: clickedCount,
        byStep: byStepRows.map((r) => ({
          step: r._id,
          total: r.total,
          sent: r.sent,
          failed: r.failed,
          skipped: r.skipped,
          opened: r.opened,
        })),
      },
    };
  }

  async preview(dto: {
    type: string;
    audience: Record<string, unknown>;
    content: Record<string, unknown>;
  }): Promise<AudiencePreview> {
    const content = dto.content as {
      mode?: string;
      steps?: number[];
      step?: number;
    };
    const audience = this.normalizeAudience(dto.audience);

    // USERS (re-engagement) audience resolves against Postgres
    if (audience.mode === 'USERS') {
      const userPreview = await this.previewUsers(audience.userFilters);
      return {
        total: userPreview.total,
        sendable: userPreview.sendable,
        noEmail: 0,
        excluded: 0,
        suppressed: userPreview.suppressed,
        noDraft: 0,
        sample: [],
      };
    }

    const steps =
      dto.type === 'SEQUENCE'
        ? (content.steps ?? [1, 2, 3, 4, 5, 6, 7, 8, 9])
        : [content.step ?? 1];
    return this.resolver.preview(
      audience,
      content.mode ?? 'LEAD_DRAFTS',
      steps,
    );
  }

  private normalizeAudience(audience: Record<string, unknown>) {
    const mode = (audience.mode as string) ?? 'FILTER';
    const filters = (audience.filters as Record<string, unknown>) ?? {};
    const userFilters = (audience.userFilters as Record<string, unknown>) ?? {};
    const toIds = (value: unknown): string[] =>
      Array.isArray(value) ? value.map((v) => String(v)) : [];
    return {
      mode,
      filters: {
        tier: filters.tier as string | undefined,
        wave: filters.wave as string | undefined,
        state: filters.state as string | undefined,
        abGroup: filters.abGroup as string | undefined,
        channel: filters.channel as string | undefined,
        tags: filters.tags as string[] | undefined,
      },
      leadIds: toIds(audience.leadIds),
      excludeLeadIds: toIds(audience.excludeLeadIds),
      userFilters: {
        plan: userFilters.plan as string | undefined,
        inactiveDays: userFilters.inactiveDays as number | undefined,
        onboardingCompleted: userFilters.onboardingCompleted as
          | boolean
          | undefined,
      },
      emails: toIds(audience.emails),
    };
  }

  /** Prisma where-clause for the USERS (re-engagement) audience. */
  private usersWhere(userFilters: {
    plan?: string;
    inactiveDays?: number;
    onboardingCompleted?: boolean;
  }): Record<string, unknown> {
    const where: Record<string, unknown> = {
      deleted_at: null,
      role: 'USER',
    };
    if (userFilters.plan) where.plan = userFilters.plan;
    if (userFilters.onboardingCompleted !== undefined) {
      where.onboarding_completed = userFilters.onboardingCompleted;
    }
    if (userFilters.inactiveDays) {
      const cutoff = new Date(
        Date.now() - userFilters.inactiveDays * 86_400_000,
      );
      where.OR = [{ last_seen_at: null }, { last_seen_at: { lt: cutoff } }];
    }
    return where;
  }

  /** Preview a USERS audience: matching platform users minus suppressed. */
  async previewUsers(userFilters: {
    plan?: string;
    inactiveDays?: number;
    onboardingCompleted?: boolean;
  }): Promise<UserAudiencePreview> {
    const users = await this.prisma.user.findMany({
      where: this.usersWhere(userFilters) as never,
      select: { email: true },
    });
    const emails = users.map((u) => u.email.toLowerCase());
    const suppressed = emails.length
      ? await this.suppressionModel
          .countDocuments({ email: { $in: emails } })
          .exec()
      : 0;
    return {
      total: emails.length,
      sendable: emails.length - suppressed,
      suppressed,
    };
  }

  /** Resolves + snapshots matching user emails into the campaign doc. */
  private async snapshotUserEmails(
    campaign: CampaignDocument,
  ): Promise<string[]> {
    const userFilters = (campaign.audience.userFilters ?? {}) as {
      plan?: string;
      inactiveDays?: number;
      onboardingCompleted?: boolean;
    };
    const users = await this.prisma.user.findMany({
      where: this.usersWhere(userFilters) as never,
      select: { email: true },
    });
    const emails = users.map((u) => u.email.toLowerCase());
    const suppressedSet = new Set(
      emails.length
        ? (
            await this.suppressionModel
              .find({ email: { $in: emails } })
              .select('email')
              .lean<{ email: string }[]>()
              .exec()
          ).map((s) => s.email)
        : [],
    );
    const sendable = emails.filter((e) => !suppressedSet.has(e));
    await this.campaignModel
      .updateOne(
        { _id: campaign._id },
        { $set: { 'audience.emails': sendable } },
      )
      .exec();
    return sendable;
  }

  private validateContent(
    type: string,
    content: {
      mode: string;
      steps?: number[];
      step?: number;
      subject?: string;
      body?: string;
    },
  ) {
    if (type === 'SEQUENCE' && content.mode === 'TEMPLATE') {
      throw new BadRequestException(
        'SEQUENCE campaigns use the per-lead 9-email drafts (LEAD_DRAFTS); TEMPLATE is only for ONE_OFF',
      );
    }
    if (content.mode === 'TEMPLATE' && (!content.subject || !content.body)) {
      throw new BadRequestException(
        'TEMPLATE content requires subject and body',
      );
    }
    if (type === 'SEQUENCE') {
      const steps = content.steps ?? [];
      if (steps.length === 0) {
        throw new BadRequestException(
          'SEQUENCE campaigns need at least one step (1-9)',
        );
      }
    }
  }

  async create(
    dto: CreateCampaignDto,
    userId: string,
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(dto.providerId)) {
      throw new BadRequestException('Invalid providerId');
    }
    const provider = await this.providerModel.findById(dto.providerId).exec();
    if (!provider) throw new NotFoundException('Provider not found');

    this.validateContent(dto.type, dto.content);

    const audience = this.normalizeAudience(
      dto.audience as unknown as Record<string, unknown>,
    );
    if (audience.mode === 'IDS' && audience.leadIds.length === 0) {
      throw new BadRequestException('IDS audience requires at least one lead');
    }

    const perMinute = Math.min(dto.perMinute ?? 15, provider.perMinuteLimit);

    const campaign = await this.campaignModel.create({
      name: dto.name.trim(),
      type: dto.type,
      providerRef: provider._id,
      status: 'DRAFT',
      audience: {
        mode: audience.mode,
        filters: audience.filters,
        leadIds: audience.leadIds.map((id) => new Types.ObjectId(id)),
        excludeLeadIds: audience.excludeLeadIds.map(
          (id) => new Types.ObjectId(id),
        ),
        userFilters: audience.mode === 'USERS' ? audience.userFilters : {},
        emails: [],
      },
      content: dto.content,
      schedule: {
        startAt: dto.startAt ? new Date(dto.startAt) : new Date(),
        perMinute,
        smartSendTimes: dto.smartSendTimes ?? false,
      },
      stopOnReply: dto.stopOnReply ?? true,
      createdBy: Types.ObjectId.isValid(userId)
        ? new Types.ObjectId(userId)
        : undefined,
    });
    return this.toPlain(campaign);
  }

  async update(
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<Record<string, unknown>> {
    const campaign = await this.findCampaignOrThrow(id);
    if (campaign.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT campaigns can be edited (current: ${campaign.status})`,
      );
    }
    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.audience !== undefined) {
      const audience = this.normalizeAudience(
        dto.audience as unknown as Record<string, unknown>,
      );
      if (audience.mode === 'IDS' && audience.leadIds.length === 0) {
        throw new BadRequestException(
          'IDS audience requires at least one lead',
        );
      }
      update.audience = {
        mode: audience.mode,
        filters: audience.filters,
        leadIds: audience.leadIds.map((i) => new Types.ObjectId(i)),
        excludeLeadIds: audience.excludeLeadIds.map(
          (i) => new Types.ObjectId(i),
        ),
        userFilters: audience.mode === 'USERS' ? audience.userFilters : {},
        emails: [],
      };
    }
    if (dto.content !== undefined) {
      this.validateContent(campaign.type, dto.content as never);
      update.content = dto.content;
    }
    const schedule: Record<string, unknown> = {};
    if (dto.startAt !== undefined) schedule.startAt = new Date(dto.startAt);
    if (dto.perMinute !== undefined) {
      const provider = await this.providerModel
        .findById(campaign.providerRef)
        .exec();
      schedule.perMinute = Math.min(
        dto.perMinute,
        provider?.perMinuteLimit ?? dto.perMinute,
      );
    }
    if (dto.smartSendTimes !== undefined)
      schedule.smartSendTimes = dto.smartSendTimes;
    if (Object.keys(schedule).length > 0) {
      update.schedule = {
        ...(campaign.schedule as Record<string, unknown>),
        ...schedule,
      };
    }
    if (dto.stopOnReply !== undefined) update.stopOnReply = dto.stopOnReply;

    const updated = await this.campaignModel
      .findByIdAndUpdate(campaign._id, { $set: update }, { new: true })
      .exec();
    return this.toPlain(updated!);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const campaign = await this.findCampaignOrThrow(id);
    if (campaign.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT campaigns can be deleted (current: ${campaign.status})`,
      );
    }
    await this.campaignModel.deleteOne({ _id: campaign._id }).exec();
    return { deleted: true };
  }

  /** Validates + moves a DRAFT to SCHEDULED; the worker dispatch-tick takes over. */
  async schedule(
    id: string,
    startAt?: string,
  ): Promise<Record<string, unknown>> {
    const campaign = await this.findCampaignOrThrow(id);
    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
      throw new BadRequestException(
        `Cannot schedule a campaign in status ${campaign.status}`,
      );
    }
    const provider = await this.providerModel
      .findById(campaign.providerRef)
      .exec();
    if (!provider) throw new NotFoundException('Provider no longer exists');
    if (provider.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Provider "${provider.name}" is ${provider.status} — activate it first`,
      );
    }

    // USERS (re-engagement) campaigns: snapshot matching user emails now
    if ((campaign.audience as { mode?: string }).mode === 'USERS') {
      if (campaign.type !== 'ONE_OFF' || campaign.content.mode !== 'TEMPLATE') {
        throw new BadRequestException(
          'Re-engagement (USERS) campaigns must be ONE_OFF with TEMPLATE content',
        );
      }
      const emails = await this.snapshotUserEmails(campaign);
      if (emails.length === 0) {
        throw new BadRequestException(
          'User audience resolved to 0 sendable emails',
        );
      }
      const updatedUsers = await this.campaignModel
        .findByIdAndUpdate(
          campaign._id,
          {
            $set: {
              status: 'SCHEDULED',
              'schedule.startAt': startAt
                ? new Date(startAt)
                : (campaign.schedule as { startAt: Date }).startAt,
              error: null,
            },
          },
          { new: true },
        )
        .exec();
      this.logger.log(
        `Campaign ${String(campaign._id)} scheduled (${emails.length} user emails)`,
      );
      return this.toPlain(updatedUsers!);
    }

    const steps =
      campaign.type === 'SEQUENCE'
        ? (campaign.content.steps ?? [1, 2, 3, 4, 5, 6, 7, 8, 9])
        : [campaign.content.step ?? 1];
    const preview = await this.resolver.preview(
      campaign.audience,
      campaign.content.mode,
      steps,
    );
    if (preview.sendable === 0) {
      throw new BadRequestException(
        `Audience has no sendable leads (${preview.total} matched, ${preview.noEmail} without email, ${preview.excluded} excluded, ${preview.suppressed} suppressed, ${preview.noDraft} without drafts)`,
      );
    }

    const updated = await this.campaignModel
      .findByIdAndUpdate(
        campaign._id,
        {
          $set: {
            status: 'SCHEDULED',
            'schedule.startAt': startAt
              ? new Date(startAt)
              : (campaign.schedule as { startAt: Date }).startAt,
            error: null,
          },
        },
        { new: true },
      )
      .exec();
    this.logger.log(
      `Campaign ${String(campaign._id)} scheduled (${preview.sendable} sendable)`,
    );
    return this.toPlain(updated!);
  }

  async pause(id: string): Promise<Record<string, unknown>> {
    const campaign = await this.findCampaignOrThrow(id);
    if (campaign.status !== 'RUNNING') {
      throw new BadRequestException(
        `Only RUNNING campaigns can be paused (current: ${campaign.status})`,
      );
    }
    await this.recipientModel
      .updateMany(
        { campaignRef: campaign._id, status: 'QUEUED' },
        { $set: { campaignStatus: 'PAUSED' } },
      )
      .exec();
    const updated = await this.campaignModel
      .findByIdAndUpdate(
        campaign._id,
        { $set: { status: 'PAUSED' } },
        { new: true },
      )
      .exec();
    return this.toPlain(updated!);
  }

  async resume(id: string): Promise<Record<string, unknown>> {
    const campaign = await this.findCampaignOrThrow(id);
    if (campaign.status !== 'PAUSED') {
      throw new BadRequestException(
        `Only PAUSED campaigns can be resumed (current: ${campaign.status})`,
      );
    }
    await this.recipientModel
      .updateMany(
        { campaignRef: campaign._id, status: 'QUEUED' },
        { $set: { campaignStatus: 'RUNNING' } },
      )
      .exec();
    const updated = await this.campaignModel
      .findByIdAndUpdate(
        campaign._id,
        { $set: { status: 'RUNNING' } },
        { new: true },
      )
      .exec();
    return this.toPlain(updated!);
  }

  async cancel(id: string): Promise<Record<string, unknown>> {
    const campaign = await this.findCampaignOrThrow(id);
    if (!['SCHEDULED', 'RUNNING', 'PAUSED'].includes(campaign.status)) {
      throw new BadRequestException(
        `Cannot cancel a campaign in status ${campaign.status}`,
      );
    }
    await this.recipientModel
      .updateMany(
        { campaignRef: campaign._id, status: { $in: ['QUEUED', 'SENDING'] } },
        { $set: { status: 'CANCELLED', campaignStatus: 'CANCELLED' } },
      )
      .exec();
    const updated = await this.campaignModel
      .findByIdAndUpdate(
        campaign._id,
        { $set: { status: 'CANCELLED', completedAt: new Date() } },
        { new: true },
      )
      .exec();
    return this.toPlain(updated!);
  }

  async recipients(
    id: string,
    filters: {
      status?: string;
      search?: string;
      step?: number;
      page: number;
      limit: number;
    },
  ) {
    const campaign = await this.findCampaignOrThrow(id);
    const query: Record<string, unknown> = { campaignRef: campaign._id };
    if (filters.status) query.status = filters.status;
    if (filters.step) query.step = filters.step;
    if (filters.search) {
      const rx = new RegExp(
        filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      query.$or = [{ email: rx }, { leadName: rx }];
    }
    const page = Math.max(1, filters.page);
    const limit = Math.min(200, Math.max(1, filters.limit));
    const total = await this.recipientModel.countDocuments(query);
    const data = await this.recipientModel
      .find(query)
      .sort({ sendAt: 1 })
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

  async findCampaignOrThrow(id: string): Promise<CampaignDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Campaign not found');
    }
    const campaign = await this.campaignModel.findById(id).exec();
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /** Recipients grid as CSV (cursor-based, all pages). */
  async exportRecipientsCsv(id: string): Promise<(string | number | null)[][]> {
    const campaign = await this.findCampaignOrThrow(id);
    const rows: (string | number | null)[][] = [
      [
        'lead_id',
        'business',
        'email',
        'ab_group',
        'step',
        'status',
        'scheduled_at',
        'sent_at',
        'opens',
        'clicks',
        'subject',
        'error',
        'skip_reason',
      ],
    ];
    const cursor = this.recipientModel
      .find({ campaignRef: campaign._id })
      .sort({ sendAt: 1 })
      .cursor();
    for (
      let doc = await cursor.next();
      doc != null;
      doc = await cursor.next()
    ) {
      rows.push([
        doc.leadRef ? String(doc.leadRef) : '',
        doc.leadName ?? '',
        doc.email,
        doc.abGroup ?? '',
        doc.step,
        doc.status,
        doc.sendAt ? new Date(doc.sendAt).toISOString() : '',
        doc.sentAt ? new Date(doc.sentAt).toISOString() : '',
        doc.openCount ?? 0,
        doc.clickCount ?? 0,
        doc.subject ?? '',
        doc.error ?? '',
        doc.skipReason ?? '',
      ]);
    }
    return rows;
  }
}
