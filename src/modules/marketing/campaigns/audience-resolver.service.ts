import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import {
  LeadMessage,
  LeadMessageDocument,
} from '../schemas/lead-message.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../schemas/suppression.schema';
import {
  CampaignAudience,
  CampaignAudienceFilters,
} from '../schemas/campaign.schema';

export interface AudiencePreview {
  total: number;
  sendable: number;
  noEmail: number;
  excluded: number;
  suppressed: number;
  noDraft: number;
  sample: {
    _id: string;
    businessName?: string;
    email?: string;
    state?: string;
    fitTier?: string;
    waveKey?: string;
    abGroup?: string;
  }[];
}

export interface SendableLead {
  _id: Types.ObjectId;
  email: string;
  state?: string;
  unsubToken?: string;
  businessName?: string;
  abGroup?: string;
}

const LOOKUP_CHUNK = 1000;

/**
 * Resolves a campaign audience to lead ids. Shared by the API
 * (preview endpoint) and the marketing worker (dispatch).
 */
@Injectable()
export class AudienceResolverService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadMessage.name)
    private readonly messageModel: Model<LeadMessageDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
  ) {}

  /** Mongo filter for the audience, WITHOUT email/exclusion constraints. */
  baseFilter(audience: CampaignAudience): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (audience.mode === 'IDS') {
      const ids = (audience.leadIds ?? [])
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(String(id)));
      filter._id = { $in: ids };
    } else {
      const f: CampaignAudienceFilters = audience.filters ?? {};
      if (f.tier) filter.fitTier = f.tier;
      if (f.wave) filter.waveKey = f.wave;
      if (f.state) filter.state = f.state.toUpperCase();
      if (f.abGroup) filter.abGroup = f.abGroup;
      if (f.channel) filter.recommendedChannel = f.channel;
      if (f.tags?.length) filter.tags = { $in: f.tags };
    }
    const excludeIds = (audience.excludeLeadIds ?? [])
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(String(id)));
    if (excludeIds.length > 0) {
      filter._id = {
        ...(filter._id as Record<string, unknown>),
        $nin: excludeIds,
      };
    }
    return filter;
  }

  /**
   * Preview counts for the wizard: total matches, how many are sendable,
   * and why the rest are not (no email / excluded / suppressed / no draft).
   */
  async preview(
    audience: CampaignAudience,
    contentMode: string,
    steps: number[],
  ): Promise<AudiencePreview> {
    const filter = this.baseFilter(audience);
    const leads = await this.leadModel
      .find(filter)
      .select(
        'businessName email state fitTier waveKey abGroup excludeFromSend',
      )
      .lean<
        {
          _id: Types.ObjectId;
          businessName?: string;
          email?: string;
          state?: string;
          fitTier?: string;
          waveKey?: string;
          abGroup?: string;
          excludeFromSend?: boolean;
        }[]
      >()
      .exec();

    let noEmail = 0;
    let excluded = 0;
    const emailsToCheck: string[] = [];
    const candidateIds: Types.ObjectId[] = [];
    for (const lead of leads) {
      if (lead.excludeFromSend) {
        excluded++;
        continue;
      }
      if (!lead.email) {
        noEmail++;
        continue;
      }
      emailsToCheck.push(lead.email);
      candidateIds.push(lead._id);
    }

    const suppressedEmails = new Set<string>();
    for (let i = 0; i < emailsToCheck.length; i += LOOKUP_CHUNK) {
      const chunk = emailsToCheck.slice(i, i + LOOKUP_CHUNK);
      const found = await this.suppressionModel
        .find({ email: { $in: chunk } })
        .select('email')
        .lean<{ email: string }[]>()
        .exec();
      for (const doc of found) suppressedEmails.add(doc.email);
    }

    const sendableIds: Types.ObjectId[] = [];
    let suppressed = 0;
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      if (lead.excludeFromSend || !lead.email) continue;
      if (suppressedEmails.has(lead.email)) {
        suppressed++;
        continue;
      }
      sendableIds.push(lead._id);
    }

    // Draft availability (LEAD_DRAFTS mode only)
    let noDraft = 0;
    if (contentMode === 'LEAD_DRAFTS' && steps.length > 0) {
      const withDrafts = await this.messageModel
        .distinct('leadRef', {
          leadRef: { $in: sendableIds },
          step: { $in: steps },
          body: { $exists: true, $ne: '' },
        })
        .exec();
      const draftSet = new Set(
        (withDrafts as unknown[]).map((id) => String(id)),
      );
      noDraft = sendableIds.filter((id) => !draftSet.has(String(id))).length;
    }

    const sampleLeads = leads
      .filter((l) => !l.excludeFromSend && l.email)
      .slice(0, 5)
      .map((l) => ({
        _id: String(l._id),
        businessName: l.businessName,
        email: l.email,
        state: l.state,
        fitTier: l.fitTier,
        waveKey: l.waveKey,
        abGroup: l.abGroup,
      }));

    return {
      total: leads.length,
      sendable: sendableIds.length,
      noEmail,
      excluded,
      suppressed,
      noDraft,
      sample: sampleLeads,
    };
  }

  /**
   * Returns the leads a campaign will actually send to:
   * has email, not excluded, not suppressed.
   */
  async resolveSendable(audience: CampaignAudience): Promise<SendableLead[]> {
    const filter = this.baseFilter(audience);
    Object.assign(filter, {
      excludeFromSend: { $ne: true },
      email: { $exists: true, $nin: [null, ''] },
    });

    const leads = await this.leadModel
      .find(filter)
      .select('businessName email state unsubToken abGroup')
      .lean<
        {
          _id: Types.ObjectId;
          businessName?: string;
          email?: string;
          state?: string;
          unsubToken?: string;
          abGroup?: string;
        }[]
      >()
      .exec();

    if (leads.length === 0) return [];

    const emails = leads.map((l) => l.email!);
    const suppressed = new Set<string>();
    for (let i = 0; i < emails.length; i += LOOKUP_CHUNK) {
      const chunk = emails.slice(i, i + LOOKUP_CHUNK);
      const found = await this.suppressionModel
        .find({ email: { $in: chunk } })
        .select('email')
        .lean<{ email: string }[]>()
        .exec();
      for (const doc of found) suppressed.add(doc.email);
    }

    return leads
      .filter((l) => !suppressed.has(l.email!))
      .map((l) => ({
        _id: l._id,
        email: l.email!,
        state: l.state,
        unsubToken: l.unsubToken,
        businessName: l.businessName,
        abGroup: l.abGroup,
      }));
  }
}
