import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Raw uploaded spreadsheet bytes (kept in Mongo so the worker can re-read it). */
@Schema({ collection: 'import_files', timestamps: true, versionKey: false })
export class ImportFile {
  _id: Types.ObjectId;

  @Prop({ required: true, type: String })
  filename: string;

  @Prop({ required: true, type: String })
  mimeType: string;

  @Prop({ required: true, type: Number })
  size: number;

  @Prop({ required: true, type: Buffer })
  data: Buffer;

  createdAt: Date;
  updatedAt: Date;
}

export type ImportFileDocument = HydratedDocument<ImportFile>;

export const ImportFileSchema = SchemaFactory.createForClass(ImportFile);
