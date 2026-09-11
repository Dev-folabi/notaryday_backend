import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';

/** Fallback seed — mirrors the campaign spreadsheet's Outreach_Playbook sheet. */
const FALLBACK_PLAYBOOKS = [
  {
    signal: 'Scanback/equipment signal',
    angle: 'Lead with CITT Engine and automatic scanback time-blocking',
    cta: 'Ask them to test a day with two scanback-required closings',
  },
  {
    signal: 'Wide service area/mobile signal',
    angle:
      'Lead with drive-time checks, mileage-adjusted net earnings and route optimisation',
    cta: 'Ask them to compare the optimized route with their normal route',
  },
  {
    signal: 'Online booking signal',
    angle: 'Lead with Smart Booking Page',
    cta: 'Show how slots are removed when travel or scanback clearance fails',
  },
  {
    signal: 'Extended availability signal',
    angle: 'Lead with Gap Finder',
    cta: 'Offer to rank pending assignments that fit open windows',
  },
  {
    signal: 'Signing platform/certification signal',
    angle: 'Lead with AI Job Import',
    cta: 'Use a real confirmation email or screenshot as the demo',
  },
];

@Injectable()
export class PlaybooksService {
  private readonly logger = new Logger(PlaybooksService.name);

  constructor(
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
  ) {}

  async list(): Promise<PlaybookDocument[]> {
    const count = await this.playbookModel.countDocuments({}).exec();
    if (count === 0) {
      await this.playbookModel.insertMany(FALLBACK_PLAYBOOKS);
      this.logger.log(`Seeded ${FALLBACK_PLAYBOOKS.length} fallback playbooks`);
    }
    return this.playbookModel.find().sort({ createdAt: 1 }).exec();
  }

  /**
   * Upserts playbooks parsed from a spreadsheet whose headers look like the
   * Outreach_Playbook sheet (Observed signal / Recommended angle / Suggested CTA).
   */
  async ingestFromSheet(rows: string[][]): Promise<number> {
    if (!rows || rows.length < 2) return 0;
    const header = rows[0].map((h) => h.toLowerCase().trim());
    const findCol = (...names: string[]) =>
      header.findIndex((h) => names.some((n) => h.includes(n)));
    const signalCol = findCol('observed signal', 'signal');
    const angleCol = findCol('recommended angle', 'angle');
    const ctaCol = findCol('cta', 'call to action');
    if (signalCol === -1 || angleCol === -1) return 0;

    let count = 0;
    for (const row of rows.slice(1)) {
      const signal = (row[signalCol] ?? '').trim();
      const angle = (row[angleCol] ?? '').trim();
      const cta = ctaCol >= 0 ? (row[ctaCol] ?? '').trim() : '';
      if (!signal || !angle) continue;
      await this.playbookModel.updateOne(
        { signal },
        { $set: { signal, angle, cta } },
        { upsert: true },
      );
      count++;
    }
    if (count > 0) this.logger.log(`Ingested ${count} playbooks from sheet`);
    return count;
  }
}
