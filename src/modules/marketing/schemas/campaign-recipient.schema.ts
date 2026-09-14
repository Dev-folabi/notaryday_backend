import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { RECIPIENT_STATUSES } from '../marketing.constants';

/**
 * One row per (campaign, lead, step) — the live replacement for the
 * spreadsheet's AB_Test_Tracker. Claimed by the send-tick cron
 * (QUEUED -> SENDING) and finalized by the send-email worker job.
 */
@Schema({
  collection: 'campaign_recipients',
  timestamps: true,
  versionKey: false,
})
export class CampaignRecipient {
  _id: Types.ObjectId;

  @Prop({ required: true, index: true, type: Types.ObjectId })
  campaignRef: Types.ObjectId;

  @Prop({ index: true, type: Types.ObjectId })
  leadRef: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 9, type: Number })
  step: number;

  @Prop({ required: true, lowercase: true, index: true, type: String })
  email: string;

  @Prop({
    default: 'QUEUED',
    enum: RECIPIENT_STATUSES,
    index: true,
    type: String,
  })
  status: string;

  /** Denormalized snapshot of campaign status for tick filtering. */
  @Prop({ index: true, type: String })
  campaignStatus: string;

  @Prop({ required: true, index: true, type: Types.ObjectId })
  providerRef: Types.ObjectId;

  @Prop({ index: true, sparse: true, type: String })
  providerMessageId: string;

  @Prop({ required: true, index: true, type: Date })
  sendAt: Date;

  @Prop({ type: Date })
  claimedAt: Date;

  @Prop({ type: Date })
  sentAt: Date;

  /** Subject snapshot of what was actually sent (audit). */
  @Prop({ type: String })
  subject: string;

  @Prop({ type: String })
  error: string;

  @Prop({ type: String })
  skipReason: string;

  @Prop({ default: 0, type: Number })
  openCount: number;

  @Prop({ default: 0, type: Number })
  clickCount: number;

  @Prop({ type: [Date], default: [] })
  openedAt: Date[];

  @Prop({ type: [Date], default: [] })
  clickedAt: Date[];

  @Prop({ type: Date })
  firstOpenedAt: Date;

  /** Per-recipient unsubscribe token (direct sends to non-leads). */
  @Prop({ index: true, sparse: true, type: String })
  unsubToken: string;

  /** Business-name snapshot for the monitor grid. */
  @Prop({ type: String })
  leadName: string;

  @Prop({ index: true, enum: ['A', 'B'], type: String })
  abGroup: string;

  createdAt: Date;
  updatedAt: Date;
}

export type CampaignRecipientDocument = HydratedDocument<CampaignRecipient>;

export const CampaignRecipientSchema =
  SchemaFactory.createForClass(CampaignRecipient);

CampaignRecipientSchema.index({ campaignRef: 1, step: 1 });
CampaignRecipientSchema.index({ status: 1, campaignStatus: 1, sendAt: 1 });
