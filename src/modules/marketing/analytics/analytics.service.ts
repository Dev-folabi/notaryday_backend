import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../schemas/campaign-recipient.schema';
import { EmailEvent, EmailEventDocument } from '../schemas/email-event.schema';

export interface AnalyticsOverview {
  totals: {
    leads: number;
    leadsWithEmail: number;
    sent: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
    bounced: number;
    failed: number;
    converted: number;
  };
  funnel: {
    leads: number;
    withEmail: number;
    sent: number;
    opened: number;
    clicked: number;
    converted: number;
  };
  sendsPerDay: {
    date: string;
    sent: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
    bounced: number;
    failed: number;
  }[];
  abTest: {
    group: string;
    assigned: number;
    sent: number;
    opened: number;
    clicked: number;
    converted: number;
    openRate: number | null;
    clickRate: number | null;
    conversionRate: number | null;
  }[];
  steps: {
    step: number;
    sent: number;
    opened: number;
    openRate: number | null;
    skipped: number;
    failed: number;
  }[];
}

const DAY_MS = 86_400_000;

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
  ) {}

  async overview(days = 30): Promise<AnalyticsOverview> {
    const since = new Date(Date.now() - days * DAY_MS);

    const [
      leads,
      leadsWithEmail,
      sentCount,
      openedCount,
      clickedCount,
      unsubscribedCount,
      bouncedCount,
      failedCount,
      convertedCount,
    ] = await Promise.all([
      this.leadModel.countDocuments({}),
      this.leadModel.countDocuments({
        email: { $exists: true, $nin: [null, ''] },
      }),
      this.recipientModel.countDocuments({ status: 'SENT' }),
      this.recipientModel.countDocuments({ openCount: { $gt: 0 } }),
      this.recipientModel.countDocuments({ clickCount: { $gt: 0 } }),
      this.eventModel.countDocuments({ type: 'UNSUBSCRIBED' }),
      this.recipientModel.countDocuments({ status: 'BOUNCED' }),
      this.recipientModel.countDocuments({ status: 'FAILED' }),
      this.leadModel.countDocuments({ status: 'CONVERTED' }),
    ]);

    // ---- Time series (per day, last N days) ----
    const seriesRows = await this.eventModel.aggregate<{
      _id: string;
      sent: number;
      opened: number;
      clicked: number;
      unsubscribed: number;
      bounced: number;
      failed: number;
    }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          sent: { $sum: { $cond: [{ $eq: ['$type', 'SENT'] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $eq: ['$type', 'OPENED'] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $eq: ['$type', 'CLICKED'] }, 1, 0] } },
          unsubscribed: {
            $sum: { $cond: [{ $eq: ['$type', 'UNSUBSCRIBED'] }, 1, 0] },
          },
          bounced: { $sum: { $cond: [{ $eq: ['$type', 'BOUNCED'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$type', 'FAILED'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const seriesMap = new Map(seriesRows.map((r) => [r._id, r]));
    const sendsPerDay: AnalyticsOverview['sendsPerDay'] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
      const row = seriesMap.get(date);
      sendsPerDay.push({
        date,
        sent: row?.sent ?? 0,
        opened: row?.opened ?? 0,
        clicked: row?.clicked ?? 0,
        unsubscribed: row?.unsubscribed ?? 0,
        bounced: row?.bounced ?? 0,
        failed: row?.failed ?? 0,
      });
    }

    // ---- A/B test aggregates (across all campaigns) ----
    const abRows = await this.recipientModel.aggregate<{
      _id: string | null;
      assigned: number;
      sent: number;
      opened: number;
      clicked: number;
    }>([
      {
        $group: {
          _id: '$abGroup',
          assigned: { $sum: 1 },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] } },
          clicked: { $sum: { $cond: [{ $gt: ['$clickCount', 0] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    // Conversions by AB group via lead join
    const convRows = await this.leadModel.aggregate<{
      _id: string | null;
      n: number;
    }>([
      { $match: { status: 'CONVERTED', abGroup: { $ne: null } } },
      { $group: { _id: '$abGroup', n: { $sum: 1 } } },
    ]);
    const convByGroup = new Map(convRows.map((r) => [r._id ?? '—', r.n]));

    const abTest = abRows.map((r) => {
      const group = r._id ?? '—';
      const converted = convByGroup.get(group) ?? 0;
      const rate = (n: number, d: number) =>
        d > 0 ? Math.round((n / d) * 1000) / 10 : null;
      return {
        group,
        assigned: r.assigned,
        sent: r.sent,
        opened: r.opened,
        clicked: r.clicked,
        converted,
        openRate: rate(r.opened, r.sent),
        clickRate: rate(r.clicked, r.sent),
        conversionRate: rate(converted, r.sent),
      };
    });

    // ---- Sequence step performance (aggregated across campaigns) ----
    const stepRows = await this.recipientModel.aggregate<{
      _id: number;
      sent: number;
      opened: number;
      skipped: number;
      failed: number;
    }>([
      {
        $group: {
          _id: '$step',
          sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $gt: ['$openCount', 0] }, 1, 0] } },
          skipped: {
            $sum: {
              $cond: [{ $in: ['$status', ['SKIPPED', 'CANCELLED']] }, 1, 0],
            },
          },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const steps = stepRows.map((r) => ({
      step: r._id,
      sent: r.sent,
      opened: r.opened,
      openRate: r.sent > 0 ? Math.round((r.opened / r.sent) * 1000) / 10 : null,
      skipped: r.skipped,
      failed: r.failed,
    }));

    return {
      totals: {
        leads,
        leadsWithEmail,
        sent: sentCount,
        opened: openedCount,
        clicked: clickedCount,
        unsubscribed: unsubscribedCount,
        bounced: bouncedCount,
        failed: failedCount,
        converted: convertedCount,
      },
      funnel: {
        leads,
        withEmail: leadsWithEmail,
        sent: sentCount,
        opened: openedCount,
        clicked: clickedCount,
        converted: convertedCount,
      },
      sendsPerDay,
      abTest,
      steps,
    };
  }

  /** Engagement timeline for a single lead (used by lead detail). */
  async leadTimeline(leadId: string) {
    if (!Types.ObjectId.isValid(leadId)) return [];
    return this.eventModel
      .find({ leadRef: new Types.ObjectId(leadId) })
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
  }
}
