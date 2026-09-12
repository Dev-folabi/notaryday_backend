import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PROVIDER_STATUSES, PROVIDER_TYPES } from '../marketing.constants';

/** Email provider account (Resend / Brevo / Zoho SMTP / Gmail SMTP). */
@Schema({ collection: 'providers', timestamps: true, versionKey: false })
export class EmailProvider {
  _id: Types.ObjectId;

  @Prop({ required: true, type: String })
  name: string;

  @Prop({
    required: true,
    enum: PROVIDER_TYPES,
    index: true,
    type: String,
  })
  type: string;

  @Prop({ required: true, type: String })
  fromName: string;

  @Prop({ required: true, lowercase: true, type: String })
  fromEmail: string;

  @Prop({ lowercase: true, type: String })
  replyTo: string;

  /** AES-256-GCM encrypted JSON credentials — never returned to clients. */
  @Prop({ required: true, type: String })
  credentialsEncrypted: string;

  @Prop({ default: 30, min: 1, type: Number })
  perMinuteLimit: number;

  @Prop({ default: 100, min: 1, type: Number })
  dailyLimit: number;

  @Prop({
    default: 'ACTIVE',
    enum: PROVIDER_STATUSES,
    index: true,
    type: String,
  })
  status: string;

  @Prop({ default: false, type: Boolean })
  isDefault: boolean;

  @Prop({ default: false, type: Boolean })
  warmupEnabled: boolean;

  @Prop({ type: Date })
  warmupStartedAt: Date;

  @Prop({ default: 0, type: Number })
  warmupCurrentDaily: number;

  // Health / usage rollups maintained by the marketing worker
  @Prop({ type: String })
  healthLastError: string;

  @Prop({ type: Date })
  healthLastErrorAt: Date;

  @Prop({ type: Date })
  healthLastSuccessAt: Date;

  @Prop({ default: 0, type: Number })
  sentToday: number;

  // YYYY-MM-DD the sentToday counter refers to
  @Prop({ type: String })
  sentTodayDate: string;

  @Prop({ type: String })
  notes: string;

  createdAt: Date;
  updatedAt: Date;
}

export type EmailProviderDocument = HydratedDocument<EmailProvider>;

export const EmailProviderSchema = SchemaFactory.createForClass(EmailProvider);

EmailProviderSchema.index({ isDefault: 1 }, { sparse: true });
