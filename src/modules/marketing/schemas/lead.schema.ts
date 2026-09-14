import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  AB_GROUPS,
  FIT_TIERS,
  LEAD_STATUSES,
  WAVE_KEYS,
} from '../marketing.constants';

@Schema({ collection: 'leads', timestamps: true, versionKey: false })
export class Lead {
  _id: Types.ObjectId;

  // ND-00001 style identifier from the campaign spreadsheet
  @Prop({ index: true, sparse: true, type: String })
  leadId: string;

  @Prop({ enum: FIT_TIERS, type: String, index: true })
  fitTier: string;

  @Prop({ type: Number, min: 0, max: 100 })
  prospectScore: number;

  @Prop({ index: true, type: String })
  businessName: string;

  @Prop({ type: String })
  professionalName: string;

  @Prop({ type: String })
  website: string;

  @Prop({
    lowercase: true,
    trim: true,
    index: true,
    sparse: true,
    type: String,
  })
  email: string;

  @Prop({ type: String })
  emailVerification: string;

  @Prop({ type: String })
  phone: string;

  @Prop({ type: String })
  facebookUrl: string;

  @Prop({ type: String })
  instagramUrl: string;

  @Prop({ type: String })
  address: string;

  @Prop({ type: String })
  city: string;

  @Prop({ uppercase: true, trim: true, index: true, type: String })
  state: string;

  @Prop({ type: String })
  qualificationEvidence: string;

  @Prop({ type: String })
  bestAngle: string;

  @Prop({ type: String })
  personalizationHook: string;

  @Prop({ index: true, type: String })
  recommendedChannel: string;

  @Prop({ type: String })
  emailSubject: string;

  @Prop({ type: String })
  verificationStatus: string;

  @Prop({ default: false, index: true, type: Boolean })
  excludeFromSend: boolean;

  // Raw wave label as imported, e.g. "Wave 1 (Weeks 1-2)"
  @Prop({ type: String })
  campaignWave: string;

  @Prop({ enum: WAVE_KEYS, type: String, index: true })
  waveKey: string;

  @Prop({ enum: AB_GROUPS, type: String, index: true })
  abGroup: string;

  @Prop({ enum: LEAD_STATUSES, default: 'NEW', index: true, type: String })
  status: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: String })
  notes: string;

  @Prop({ unique: true, sparse: true, type: String })
  unsubToken: string;

  // Set when a lead email matches a registered platform user (conversion event)
  @Prop({ lowercase: true, type: String })
  linkedUserEmail: string;

  @Prop({ type: Types.ObjectId, ref: 'ImportJob' })
  sourceImport: Types.ObjectId;

  // Denormalized engagement summary (maintained by the marketing worker)
  @Prop({ default: 0, type: Number })
  emailsSent: number;

  @Prop({ default: 0, type: Number })
  openedCount: number;

  @Prop({ default: 0, type: Number })
  clickedCount: number;

  @Prop({ type: [Date], default: [] })
  openedAt: Date[];

  @Prop({ type: [Date], default: [] })
  clickedAt: Date[];

  @Prop({ type: Date })
  lastContactedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type LeadDocument = HydratedDocument<Lead>;

export const LeadSchema = SchemaFactory.createForClass(Lead);

LeadSchema.index({ businessName: 'text', email: 'text' });
