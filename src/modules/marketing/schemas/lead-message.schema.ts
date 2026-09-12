import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DM_STEP } from '../marketing.constants';

/**
 * Per-lead outreach messages. Steps 1-9 are the email sequence
 * (day offsets 1,3,5,7,9,11,13,15,17); step 10 (DM_STEP) is the
 * social/phone DM message.
 */
@Schema({ collection: 'lead_messages', timestamps: true, versionKey: false })
export class LeadMessage {
  _id: Types.ObjectId;

  @Prop({ required: true, index: true, type: Types.ObjectId })
  leadRef: Types.ObjectId;

  // Convenience copy of the Lead.leadId (ND-00001) for debugging
  @Prop({ type: String })
  leadId: string;

  @Prop({ required: true, min: 1, max: DM_STEP, index: true, type: Number })
  step: number;

  @Prop({ required: true, enum: ['EMAIL', 'DM'], type: String })
  kind: 'EMAIL' | 'DM';

  @Prop({ type: String })
  subject: string;

  @Prop({ type: String })
  body: string;

  // Send day offset relative to sequence start (1,3,5,...). DM has no offset.
  @Prop({ type: Number })
  dayOffset: number;

  @Prop({ default: false, type: Boolean })
  edited: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type LeadMessageDocument = HydratedDocument<LeadMessage>;

export const LeadMessageSchema = SchemaFactory.createForClass(LeadMessage);

LeadMessageSchema.index({ leadRef: 1, step: 1 }, { unique: true });
