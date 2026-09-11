import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  LeadMessage,
  LeadMessageDocument,
} from '../schemas/lead-message.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../schemas/suppression.schema';
import { LEAD_STATUSES, WAVE_KEYS, DM_STEP } from '../marketing.constants';

export interface LeadListFilters {
  search?: string;
  tier?: string;
  wave?: string;
  state?: string;
  abGroup?: string;
  channel?: string;
  status?: string;
  hasEmail?: 'true' | 'false';
  excluded?: 'true' | 'false';
  page: number;
  limit: number;
  sort?: string;
}

export interface LeadListResult {
  data: LeadDocument[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadMessage.name)
    private readonly messageModel: Model<LeadMessageDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
  ) {}

  async list(filters: LeadListFilters): Promise<LeadListResult> {
    const query = this.buildQuery(filters);
    const page = Math.max(1, filters.page);
    const limit = Math.min(200, Math.max(1, filters.limit));
    const total = await this.leadModel.countDocuments(query);

    let sort: Record<string, 1 | -1> = { createdAt: -1 };
    switch (filters.sort) {
      case 'name':
        sort = { businessName: 1 };
        break;
      case 'score':
        sort = { prospectScore: -1 };
        break;
      case 'tier':
        sort = { fitTier: 1, prospectScore: -1 };
        break;
      case 'oldest':
        sort = { createdAt: 1 };
        break;
    }

    const data = await this.leadModel
      .find(query)
      .sort(sort)
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

  private buildQuery(filters: LeadListFilters): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    if (filters.search) {
      const rx = new RegExp(escapeRegex(filters.search.trim()), 'i');
      query.$or = [
        { businessName: rx },
        { email: rx },
        { leadId: rx },
        { professionalName: rx },
        { city: rx },
      ];
    }
    if (filters.tier) query.fitTier = filters.tier;
    if (filters.wave) query.waveKey = filters.wave;
    if (filters.state) query.state = filters.state.toUpperCase();
    if (filters.abGroup) query.abGroup = filters.abGroup;
    if (filters.channel) query.recommendedChannel = filters.channel;
    if (filters.status) query.status = filters.status;
    if (filters.excluded === 'true') query.excludeFromSend = true;
    if (filters.excluded === 'false') query.excludeFromSend = false;
    if (filters.hasEmail === 'true')
      query.email = { $exists: true, $nin: [null, ''] };
    if (filters.hasEmail === 'false') query.email = { $in: [null, ''] };
    return query;
  }

  async detail(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Lead not found');
    }
    const lead = await this.leadModel.findById(id).exec();
    if (!lead) throw new NotFoundException('Lead not found');

    let suppression: SuppressionDocument | null = null;
    if (lead.email) {
      suppression = await this.suppressionModel
        .findOne({ email: lead.email })
        .exec();
    }

    return { lead, suppression };
  }

  async stats(): Promise<{
    total: number;
    withEmail: number;
    excluded: number;
    byTier: { key: string; count: number }[];
    byWave: { key: string; count: number }[];
    byStatus: { key: string; count: number }[];
    byAbGroup: { key: string; count: number }[];
    byChannel: { key: string; count: number }[];
    byStateTop: { key: string; count: number }[];
    unsubscribed: number;
  }> {
    const [total, withEmail, excluded, unsubscribed] = await Promise.all([
      this.leadModel.countDocuments({}),
      this.leadModel.countDocuments({
        email: { $exists: true, $nin: [null, ''] },
      }),
      this.leadModel.countDocuments({ excludeFromSend: true }),
      this.leadModel.countDocuments({ status: 'UNSUBSCRIBED' }),
    ]);

    const [byTier, byWave, byStatus, byAbGroup, byChannel, byStateAgg] =
      await Promise.all([
        this.groupCount('fitTier'),
        this.groupCount('waveKey'),
        this.groupCount('status'),
        this.groupCount('abGroup'),
        this.groupCount('recommendedChannel'),
        this.leadModel.aggregate<{ _id: string; count: number }>([
          { $group: { _id: '$state', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
      ]);

    return {
      total,
      withEmail,
      excluded,
      unsubscribed,
      byTier,
      byWave,
      byStatus,
      byAbGroup,
      byChannel,
      byStateTop: byStateAgg.map((r) => ({
        key: r._id ?? '—',
        count: r.count,
      })),
    };
  }

  private async groupCount(
    field: string,
  ): Promise<{ key: string; count: number }[]> {
    const rows = await this.leadModel.aggregate<{ _id: string; count: number }>(
      [
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ],
    );
    return rows.map((r) => ({ key: r._id ?? '—', count: r.count }));
  }

  /**
   * AB-test tracker style CSV export (mirrors the spreadsheet's tracker
   * columns, with live engagement appended). Uses a cursor to keep memory
   * flat for large lead bases.
   */
  async exportCsv(filters: {
    tier?: string;
    wave?: string;
    state?: string;
    abGroup?: string;
    status?: string;
  }): Promise<(string | number | null)[][]> {
    const query = this.buildQuery({
      tier: filters.tier,
      wave: filters.wave,
      state: filters.state,
      abGroup: filters.abGroup,
      status: filters.status,
      page: 1,
      limit: 1,
    });

    const rows: (string | number | null)[][] = [
      [
        'lead_id',
        'business_name',
        'email',
        'fit_tier',
        'wave',
        'ab_group',
        'channel',
        'state',
        'status',
        'emails_sent',
        'opened',
        'clicked',
        'last_contacted_at',
        'notes',
      ],
    ];

    const cursor = this.leadModel.find(query).sort({ leadId: 1 }).cursor();
    for (
      let doc = await cursor.next();
      doc != null;
      doc = await cursor.next()
    ) {
      rows.push([
        doc.leadId ?? '',
        doc.businessName ?? '',
        doc.email ?? '',
        doc.fitTier ?? '',
        doc.waveKey ?? '',
        doc.abGroup ?? '',
        doc.recommendedChannel ?? '',
        doc.state ?? '',
        doc.status ?? '',
        doc.emailsSent ?? 0,
        doc.openedCount ?? 0,
        doc.clickedCount ?? 0,
        doc.lastContactedAt ? new Date(doc.lastContactedAt).toISOString() : '',
        doc.notes ?? '',
      ]);
    }
    return rows;
  }

  async create(dto: Record<string, unknown>): Promise<LeadDocument> {
    const data = { ...dto } as Partial<LeadDocument> & Record<string, unknown>;
    if (typeof data.email === 'string') data.email = data.email.toLowerCase();
    if (typeof data.state === 'string') data.state = data.state.toUpperCase();
    if (typeof data.excludeFromSend === 'boolean' && data.excludeFromSend) {
      data.status = 'EXCLUDED';
    } else if (data.fitTier === 'C') {
      data.status = 'NEEDS_VERIFICATION';
    }
    if (data.campaignWave && !data.waveKey) {
      data.waveKey = mapWaveLabel(data.campaignWave);
    }
    data.unsubToken = randomBytes(12).toString('hex');
    const lead = await this.leadModel.create(data);
    return lead;
  }

  async update(
    id: string,
    dto: Record<string, unknown>,
  ): Promise<LeadDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Lead not found');
    }
    const lead = await this.leadModel.findById(id).exec();
    if (!lead) throw new NotFoundException('Lead not found');

    const update: Record<string, unknown> = { ...dto };
    if (typeof update.email === 'string')
      update.email = update.email.toLowerCase();
    if (typeof update.state === 'string')
      update.state = update.state.toUpperCase();
    if (update.campaignWave !== undefined && !update.waveKey) {
      update.waveKey = mapWaveLabel(update.campaignWave as string);
    }

    const updated = await this.leadModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .exec();
    return updated!;
  }

  async bulk(
    ids: string[],
    action: string,
    value?: string,
  ): Promise<{ affected: number }> {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      throw new NotFoundException('No valid lead ids provided');
    }
    const filter = { _id: { $in: validIds } };
    const affected = await this.leadModel.countDocuments(filter);

    switch (action) {
      case 'exclude':
        await this.leadModel.updateMany(filter, [
          { $set: { excludeFromSend: true, status: 'EXCLUDED' } },
        ]);
        break;
      case 'include':
        await this.leadModel.updateMany(filter, [
          {
            $set: {
              excludeFromSend: false,
              status: {
                $cond: [{ $eq: ['$status', 'EXCLUDED'] }, 'NEW', '$status'],
              },
            },
          },
        ]);
        break;
      case 'delete':
        await this.messageModel.deleteMany({ leadRef: { $in: validIds } });
        await this.leadModel.deleteMany(filter);
        break;
      case 'tag':
        if (!value) throw new NotFoundException('Tag value required');
        await this.leadModel.updateMany(filter, { $addToSet: { tags: value } });
        break;
      case 'untag':
        if (!value) throw new NotFoundException('Tag value required');
        await this.leadModel.updateMany(filter, { $pull: { tags: value } });
        break;
      case 'status':
        if (!value || !LEAD_STATUSES.includes(value as never)) {
          throw new NotFoundException(`Invalid status "${value}"`);
        }
        await this.leadModel.updateMany(filter, { $set: { status: value } });
        break;
      default:
        throw new NotFoundException(`Unknown bulk action "${action}"`);
    }

    return { affected };
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Lead not found');
    }
    const lead = await this.leadModel.findByIdAndDelete(id).exec();
    if (!lead) throw new NotFoundException('Lead not found');
    await this.messageModel.deleteMany({ leadRef: lead._id }).exec();
    return { deleted: true };
  }

  // ---- Lead messages (9-step sequence + DM) ----

  /** List a lead's messages ordered by step. */
  async listMessages(leadId: string): Promise<LeadMessageDocument[]> {
    const lead = await this.findLeadOrThrow(leadId);
    return this.messageModel
      .find({ leadRef: lead._id })
      .sort({ step: 1 })
      .exec();
  }

  /**
   * Upsert a message by step. Existing messages are only overwritten when
   * they have not been manually edited; edited messages require force=true.
   */
  async updateMessage(
    leadId: string,
    step: number,
    dto: { subject?: string; body?: string },
    force = false,
  ): Promise<LeadMessageDocument> {
    if (step < 1 || step > DM_STEP) {
      throw new NotFoundException(`Step must be 1-${DM_STEP}`);
    }
    const lead = await this.findLeadOrThrow(leadId);

    const existing = await this.messageModel
      .findOne({ leadRef: lead._id, step })
      .exec();

    if (!existing) {
      if (dto.subject === undefined && dto.body === undefined) {
        throw new NotFoundException('Message not found for this step');
      }
      return this.messageModel.create({
        leadRef: lead._id,
        leadId: lead.leadId,
        step,
        kind: step === DM_STEP ? 'DM' : 'EMAIL',
        subject: dto.subject ?? '',
        body: dto.body ?? '',
        dayOffset: step === DM_STEP ? undefined : step * 2 - 1,
        edited: true,
      });
    }

    if (existing.edited && !force) {
      throw new NotFoundException(
        'Message was manually edited before; pass force=true to overwrite',
      );
    }

    const update: Record<string, unknown> = { edited: true };
    if (dto.subject !== undefined) update.subject = dto.subject;
    if (dto.body !== undefined) update.body = dto.body;

    const updated = await this.messageModel
      .findOneAndUpdate(
        { leadRef: lead._id, step },
        { $set: update },
        { new: true },
      )
      .exec();
    return updated!;
  }

  private async findLeadOrThrow(id: string): Promise<LeadDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Lead not found');
    }
    const lead = await this.leadModel.findById(id).exec();
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }
}

export function mapWaveLabel(raw: string): string | undefined {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return undefined;
  const waveMatch = value.match(/wave\s*(\d)/);
  if (waveMatch) {
    const n = Number(waveMatch[1]);
    if (WAVE_KEYS.includes(`WAVE_${n}` as never)) return `WAVE_${n}`;
    return undefined;
  }
  if (value.includes('social') || value.includes('phone'))
    return 'SOCIAL_PHONE';
  if (value.includes('exclud')) return 'EXCLUDED';
  return undefined;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
