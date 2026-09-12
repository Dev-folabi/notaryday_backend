import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Wave, WaveDocument } from '../schemas/wave.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../schemas/campaign-recipient.schema';

const WAVE_KEYS = ['WAVE_1', 'WAVE_2', 'WAVE_3', 'SOCIAL_PHONE'] as const;

export interface WaveRow {
  wave: Record<string, unknown>;
  progress: {
    leads: number;
    withEmail: number;
    sent: number;
    opened: number;
    clicked: number;
    failed: number;
    queued: number;
  };
}

@Injectable()
export class WavesService {
  constructor(
    @InjectModel(Wave.name) private readonly waveModel: Model<WaveDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
  ) {}

  async list(): Promise<WaveRow[]> {
    // Ensure all wave rows exist (idempotent seed by waveKey)
    for (const waveKey of WAVE_KEYS) {
      await this.waveModel.updateOne(
        { waveKey },
        {
          $setOnInsert: {
            waveKey,
            name: DEFAULT_WAVE_NAMES[waveKey],
            status: 'PLANNED',
          },
        },
        { upsert: true },
      );
    }

    const waves = await this.waveModel.find().sort({ waveKey: 1 }).exec();
    const rows: WaveRow[] = [];
    for (const wave of waves) {
      const leadAgg = await this.leadModel.aggregate<{
        total: number;
        withEmail: number;
      }>([
        { $match: { waveKey: wave.waveKey } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            withEmail: {
              $sum: {
                $cond: [{ $gt: ['$email', null] }, 1, 0],
              },
            },
          },
        },
      ]);
      const recAgg = await this.recipientModel.aggregate<{
        sent: number;
        opened: number;
        clicked: number;
        failed: number;
        queued: number;
      }>([
        // join recipients -> lead.waveKey via lookup
        {
          $lookup: {
            from: 'leads',
            localField: 'leadRef',
            foreignField: '_id',
            as: 'lead',
          },
        },
        { $unwind: '$lead' },
        { $match: { 'lead.waveKey': wave.waveKey } },
        {
          $group: {
            _id: null,
            sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } },
            opened: { $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] } },
            clicked: { $sum: { $cond: [{ $gt: ['$clickCount', 0] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
            queued: {
              $sum: {
                $cond: [{ $in: ['$status', ['QUEUED', 'SENDING']] }, 1, 0],
              },
            },
          },
        },
      ]);
      rows.push({
        wave: wave.toObject() as unknown as Record<string, unknown>,
        progress: {
          leads: leadAgg[0]?.total ?? 0,
          withEmail: leadAgg[0]?.withEmail ?? 0,
          sent: recAgg[0]?.sent ?? 0,
          opened: recAgg[0]?.opened ?? 0,
          clicked: recAgg[0]?.clicked ?? 0,
          failed: recAgg[0]?.failed ?? 0,
          queued: recAgg[0]?.queued ?? 0,
        },
      });
    }
    return rows;
  }

  async update(
    id: string,
    dto: {
      name?: string;
      plannedStart?: string;
      status?: string;
      notes?: string;
    },
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Wave not found');
    }
    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name;
    if (dto.status !== undefined) update.status = dto.status;
    if (dto.notes !== undefined) update.notes = dto.notes;
    if (dto.plannedStart !== undefined) {
      update.plannedStart = dto.plannedStart
        ? new Date(dto.plannedStart)
        : undefined;
    }
    const wave = await this.waveModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .exec();
    if (!wave) throw new NotFoundException('Wave not found');
    return wave.toObject() as unknown as Record<string, unknown>;
  }
}

const DEFAULT_WAVE_NAMES: Record<string, string> = {
  WAVE_1: 'Wave 1 — A+/A (highest intent, weeks 1–2)',
  WAVE_2: 'Wave 2 — B tier (weeks 3–4)',
  WAVE_3: 'Wave 3 — C tier, qualification-first (weeks 5–6)',
  SOCIAL_PHONE: 'Parallel social/phone track (no email)',
};
