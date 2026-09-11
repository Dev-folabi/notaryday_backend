import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { IMPORT_STATUSES } from '../marketing.constants';

export interface ImportRowError {
  row: number;
  error: string;
  leadId?: string;
}

export interface ImportOptions {
  /** Skip rows that have no email address (they can still be worked via social/phone). */
  skipNoEmail?: boolean;
}

/** Async lead-import job; the marketing worker performs the actual parsing. */
@Schema({ collection: 'import_jobs', timestamps: true, versionKey: false })
export class ImportJob {
  _id: Types.ObjectId;

  @Prop({ required: true, type: String })
  filename: string;

  @Prop({ type: String })
  mimeType: string;

  @Prop({
    default: 'UPLOADED',
    enum: IMPORT_STATUSES,
    index: true,
    type: String,
  })
  status: string;

  @Prop({ type: [String], default: [] })
  headers: string[];

  @Prop({ type: [[String]], default: [] })
  sampleRows: string[][];

  @Prop({ type: Object, default: {} })
  mapping: Record<string, number>;

  @Prop({ type: Object, default: {} })
  options: ImportOptions;

  @Prop({ default: 0, type: Number })
  totalRows: number;

  @Prop({ default: 0, type: Number })
  importedCount: number;

  @Prop({ default: 0, type: Number })
  updatedCount: number;

  @Prop({ default: 0, type: Number })
  duplicateCount: number;

  @Prop({ default: 0, type: Number })
  skippedCount: number;

  @Prop({ default: 0, type: Number })
  errorCount: number;

  @Prop({ type: [{ row: Number, error: String, leadId: String }], default: [] })
  rowErrors: ImportRowError[];

  @Prop({ type: Date })
  startedAt: Date;

  @Prop({ type: Date })
  completedAt: Date;

  /** Times the maintenance tick re-enqueued this import after a lost job. */
  @Prop({ default: 0, type: Number })
  requeueCount: number;

  @Prop({ type: String })
  error: string;

  @Prop({ type: Types.ObjectId })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ImportFile' })
  fileRef: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type ImportJobDocument = HydratedDocument<ImportJob>;

export const ImportJobSchema = SchemaFactory.createForClass(ImportJob);
