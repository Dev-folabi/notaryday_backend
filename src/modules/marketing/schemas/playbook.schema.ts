import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Outreach playbook angle (seeded from the campaign spreadsheet). */
@Schema({ collection: 'playbooks', timestamps: true, versionKey: false })
export class Playbook {
  _id: Types.ObjectId;

  @Prop({ required: true, type: String })
  signal: string;

  @Prop({ required: true, type: String })
  angle: string;

  @Prop({ required: true, type: String })
  cta: string;

  createdAt: Date;
  updatedAt: Date;
}

export type PlaybookDocument = HydratedDocument<Playbook>;

export const PlaybookSchema = SchemaFactory.createForClass(Playbook);
