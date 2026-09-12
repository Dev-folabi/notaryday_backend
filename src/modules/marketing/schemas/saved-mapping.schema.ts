import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Saved column-mapping preset so future files with the same layout auto-map. */
@Schema({ collection: 'saved_mappings', timestamps: true, versionKey: false })
export class SavedMapping {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, type: String })
  name: string;

  @Prop({ required: true, type: Object })
  mapping: Record<string, number>;

  @Prop({ type: [String], default: [] })
  headers: string[];

  createdAt: Date;
  updatedAt: Date;
}

export type SavedMappingDocument = HydratedDocument<SavedMapping>;

export const SavedMappingSchema = SchemaFactory.createForClass(SavedMapping);
