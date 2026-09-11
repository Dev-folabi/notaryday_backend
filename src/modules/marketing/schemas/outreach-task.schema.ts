import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TASK_CHANNELS, TASK_STATUSES } from '../marketing.constants';

/**
 * Manual outreach task for the parallel social/phone track — auto-created
 * on import for leads whose recommended channel is not email.
 */
@Schema({ collection: 'outreach_tasks', timestamps: true, versionKey: false })
export class OutreachTask {
  _id: Types.ObjectId;

  @Prop({ required: true, index: true, type: Types.ObjectId })
  leadRef: Types.ObjectId;

  @Prop({ required: true, enum: TASK_CHANNELS, type: String })
  channel: string;

  @Prop({ default: 'TODO', enum: TASK_STATUSES, index: true, type: String })
  status: string;

  /** Pre-filled DM message (from the imported DM Message column). */
  @Prop({ type: String })
  message: string;

  @Prop({ type: Date })
  dueDate: Date;

  @Prop({ type: Date })
  completedAt: Date;

  @Prop({ type: String })
  notes: string;

  @Prop({ type: Types.ObjectId })
  sourceImport: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type OutreachTaskDocument = HydratedDocument<OutreachTask>;

export const OutreachTaskSchema = SchemaFactory.createForClass(OutreachTask);

OutreachTaskSchema.index({ leadRef: 1, channel: 1 }, { unique: true });
