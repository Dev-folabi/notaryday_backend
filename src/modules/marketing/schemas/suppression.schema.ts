import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SUPPRESSION_TYPES } from '../marketing.constants';

/**
 * Global suppression list. Checked at campaign dispatch AND at send time.
 * type=UNSUBSCRIBE rows carry the unsubscribe token used in /u/:token links.
 */
@Schema({ collection: 'suppressions', timestamps: true, versionKey: false })
export class Suppression {
  _id: Types.ObjectId;

  @Prop({
    required: true,
    lowercase: true,
    trim: true,
    unique: true,
    type: String,
  })
  email: string;

  @Prop({ required: true, enum: SUPPRESSION_TYPES, type: String })
  type: string;

  @Prop({ type: String })
  reason: string;

  @Prop({ index: true, sparse: true, type: String })
  token: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadRef: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type SuppressionDocument = HydratedDocument<Suppression>;

export const SuppressionSchema = SchemaFactory.createForClass(Suppression);
