import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EMAIL_EVENT_SOURCES, EMAIL_EVENT_TYPES } from '../marketing.constants';

/** Append-only engagement log (sent/delivered/bounced/opened/clicked/...). */
@Schema({
  collection: 'email_events',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class EmailEvent {
  _id: Types.ObjectId;

  @Prop({ index: true, type: Types.ObjectId })
  campaignRef: Types.ObjectId;

  @Prop({ index: true, type: Types.ObjectId })
  recipientRef: Types.ObjectId;

  @Prop({ index: true, type: Types.ObjectId })
  leadRef: Types.ObjectId;

  @Prop({ lowercase: true, type: String })
  email: string;

  @Prop({ required: true, enum: EMAIL_EVENT_TYPES, index: true, type: String })
  type: string;

  @Prop({ type: String })
  provider: string;

  @Prop({ type: String })
  providerMessageId: string;

  @Prop({ enum: EMAIL_EVENT_SOURCES, type: String })
  source: string;

  @Prop({ type: Object })
  meta: Record<string, unknown>;

  createdAt: Date;
}

export type EmailEventDocument = HydratedDocument<EmailEvent>;

export const EmailEventSchema = SchemaFactory.createForClass(EmailEvent);

EmailEventSchema.index({ createdAt: 1 });
