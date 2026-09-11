import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { WAVE_STATUSES } from '../marketing.constants';

/**
 * A campaign wave (Wave 1/2/3 or the parallel social/phone track) with its
 * planned start date. Progress is derived from leads + recipients.
 */
@Schema({ collection: 'waves', timestamps: true, versionKey: false })
export class Wave {
  _id: Types.ObjectId;

  @Prop({
    required: true,
    unique: true,
    enum: ['WAVE_1', 'WAVE_2', 'WAVE_3', 'SOCIAL_PHONE'],
    type: String,
  })
  waveKey: string;

  @Prop({ required: true, type: String })
  name: string;

  @Prop({ type: Date })
  plannedStart: Date;

  @Prop({ default: 'PLANNED', enum: WAVE_STATUSES, type: String })
  status: string;

  @Prop({ type: String })
  notes: string;

  createdAt: Date;
  updatedAt: Date;
}

export type WaveDocument = HydratedDocument<Wave>;

export const WaveSchema = SchemaFactory.createForClass(Wave);
