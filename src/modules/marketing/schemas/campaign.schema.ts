import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AUDIENCE_MODES,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TYPES,
  CONTENT_MODES,
} from '../marketing.constants';

export interface CampaignAudienceFilters {
  tier?: string;
  wave?: string;
  state?: string;
  abGroup?: string;
  channel?: string;
  tags?: string[];
}

/** Platform-user filters for re-engagement campaigns (mode=USERS). */
export interface CampaignUserFilters {
  plan?: string;
  /** No login for at least N days. */
  inactiveDays?: number;
  onboardingCompleted?: boolean;
}

export interface CampaignAudience {
  mode: string; // FILTER | IDS | USERS
  filters: CampaignAudienceFilters;
  leadIds?: (Types.ObjectId | string)[];
  excludeLeadIds?: (Types.ObjectId | string)[];
  userFilters?: CampaignUserFilters;
  /** Snapshot of resolved user emails (USERS mode, taken at schedule time). */
  emails?: string[];
}

export interface CampaignContent {
  mode: string; // LEAD_DRAFTS | TEMPLATE
  /** ONE_OFF + LEAD_DRAFTS: which sequence step to send. */
  step?: number;
  /** SEQUENCE + LEAD_DRAFTS: which steps (1-9) make up the sequence. */
  steps?: number[];
  /** TEMPLATE mode content with {{variables}}. */
  subject?: string;
  body?: string;
}

/**
 * A marketing campaign. SCHEDULED campaigns are dispatched by the marketing
 * worker's dispatch-tick cron, which materializes CampaignRecipient rows with
 * paced sendAt times; the send-tick cron then claims and enqueues sends.
 */
@Schema({ collection: 'campaigns', timestamps: true, versionKey: false })
export class Campaign {
  _id: Types.ObjectId;

  @Prop({ required: true, type: String })
  name: string;

  @Prop({
    required: true,
    enum: CAMPAIGN_TYPES,
    index: true,
    type: String,
  })
  type: string;

  @Prop({ required: true, index: true, type: Types.ObjectId })
  providerRef: Types.ObjectId;

  @Prop({
    default: 'DRAFT',
    enum: CAMPAIGN_STATUSES,
    index: true,
    type: String,
  })
  status: string;

  @Prop({
    required: true,
    type: {
      mode: { type: String, enum: AUDIENCE_MODES, default: 'FILTER' },
      filters: { type: Object, default: {} },
      leadIds: { type: [Types.ObjectId], default: [] },
      excludeLeadIds: { type: [Types.ObjectId], default: [] },
      userFilters: { type: Object, default: {} },
      emails: { type: [String], default: [] },
    },
  })
  audience: CampaignAudience;

  @Prop({
    required: true,
    type: {
      mode: { type: String, enum: CONTENT_MODES },
      step: { type: Number },
      steps: { type: [Number] },
      subject: { type: String },
      body: { type: String },
    },
  })
  content: CampaignContent;

  @Prop({
    required: true,
    type: {
      startAt: { type: Date, required: true },
      perMinute: { type: Number, required: true },
      smartSendTimes: { type: Boolean, default: false },
    },
  })
  schedule: {
    startAt: Date;
    perMinute: number;
    smartSendTimes: boolean;
  };

  @Prop({ default: true, type: Boolean })
  stopOnReply: boolean;

  @Prop({ type: Date })
  dispatchStartedAt: Date;

  @Prop({ type: Date })
  completedAt: Date;

  @Prop({ type: String })
  error: string;

  @Prop({ type: Types.ObjectId })
  createdBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type CampaignDocument = HydratedDocument<Campaign>;

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
