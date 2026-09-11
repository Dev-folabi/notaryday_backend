import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { QUEUE_MARKETING } from '../../../queues/queue.constants';
import { ImportFile, ImportFileDocument } from '../schemas/import-file.schema';
import { ImportJob, ImportJobDocument } from '../schemas/import-job.schema';
import {
  SavedMapping,
  SavedMappingDocument,
} from '../schemas/saved-mapping.schema';
import { IMPORT_TARGET_FIELDS } from '../marketing.constants';
import { isSpreadsheetFile, parseSpreadsheetPreview } from './spreadsheet.util';
import { suggestMapping } from './lead-ingest.util';
import { SaveMappingDto } from '../dto/import.dto';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @InjectModel(ImportJob.name)
    private readonly jobModel: Model<ImportJobDocument>,
    @InjectModel(ImportFile.name)
    private readonly fileModel: Model<ImportFileDocument>,
    @InjectModel(SavedMapping.name)
    private readonly mappingModel: Model<SavedMappingDocument>,
    @InjectQueue(QUEUE_MARKETING) private readonly marketingQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  /** Handles multipart upload: stores file + returns headers, samples, suggested mapping. */
  async upload(
    file: {
      originalname: string;
      buffer: Buffer;
      mimetype: string;
      size: number;
    },
    createdBy: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('File exceeds the 15MB limit');
    }
    if (!isSpreadsheetFile(file.originalname)) {
      throw new BadRequestException(
        'Unsupported file type — upload .xlsx or .csv',
      );
    }

    let preview: Awaited<ReturnType<typeof parseSpreadsheetPreview>>;
    try {
      preview = await parseSpreadsheetPreview(file.buffer, file.originalname);
    } catch (error) {
      throw new BadRequestException(
        `Could not parse file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const savedFile = await this.fileModel.create({
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      data: file.buffer,
    });

    const job = await this.jobModel.create({
      filename: file.originalname,
      mimeType: file.mimetype,
      status: 'UPLOADED',
      headers: preview.headers,
      sampleRows: preview.sampleRows,
      totalRows: preview.totalRows,
      mapping: suggestMapping(preview.headers),
      createdBy: Types.ObjectId.isValid(createdBy)
        ? new Types.ObjectId(createdBy)
        : undefined,
      fileRef: savedFile._id,
    });

    this.logger.log(
      `Import uploaded: ${file.originalname} (${preview.totalRows} rows, job ${String(job._id)})`,
    );

    const presets = await this.mappingModel
      .find()
      .sort({ updatedAt: -1 })
      .limit(20)
      .exec();

    return {
      import: job,
      suggestedMapping: job.mapping,
      presets: presets.map((p) => ({
        id: p._id,
        name: p.name,
        mapping: p.mapping,
      })),
    };
  }

  async list() {
    return this.jobModel
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-rowErrors')
      .exec();
  }

  async detail(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Import not found');
    }
    const job = await this.jobModel.findById(id).exec();
    if (!job) throw new NotFoundException('Import not found');
    return job;
  }

  /** Saves the column mapping (and optionally a preset) for an uploaded import. */
  async saveMapping(id: string, dto: SaveMappingDto) {
    const job = await this.findEditableJob(id);
    this.validateMapping(dto.mapping, job);

    job.mapping = dto.mapping;
    job.status = 'MAPPED';
    await job.save();

    if (dto.saveAsPreset) {
      await this.mappingModel.findOneAndUpdate(
        { name: dto.saveAsPreset },
        { name: dto.saveAsPreset, mapping: dto.mapping, headers: job.headers },
        { upsert: true, new: true },
      );
    }

    return job;
  }

  /** Applies a saved preset mapping to an uploaded import. */
  async applyPreset(id: string, presetId: string) {
    const job = await this.findEditableJob(id);
    const preset = await this.mappingModel.findById(presetId).exec();
    if (!preset) throw new NotFoundException('Mapping preset not found');
    this.validateMapping(preset.mapping, job);

    job.mapping = preset.mapping;
    job.status = 'MAPPED';
    await job.save();
    return job;
  }

  /** Enqueues the import for processing by the marketing worker. */
  async start(id: string, options: { skipNoEmail?: boolean }) {
    const job = await this.detail(id);
    if (!['UPLOADED', 'MAPPED', 'FAILED'].includes(job.status)) {
      throw new BadRequestException(
        `Import cannot be started from status ${job.status}`,
      );
    }
    if (!job.mapping || Object.keys(job.mapping).length === 0) {
      throw new BadRequestException('Save a column mapping first');
    }

    const previousStatus = job.status;
    job.status = 'QUEUED';
    job.options = { ...job.options, ...options };
    await job.save();

    // No jobId here on purpose: a dedupe id stays reserved by retained
    // completed/failed jobs in Redis, which would silently drop re-adds
    // (leaving the import stuck QUEUED forever). Double-processing is
    // instead guarded inside runImport via the PROCESSING status.
    let enqueued = false;
    await Promise.race([
      this.marketingQueue
        .add('import-file', { importId: String(job._id) })
        .then(() => {
          enqueued = true;
        }),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]).catch((error) => {
      this.logger.error(
        `Failed to enqueue import ${String(job._id)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    if (!enqueued) {
      job.status = previousStatus;
      await job.save();
      throw new BadRequestException(
        'Could not queue the import — is Redis running?',
      );
    }

    return job;
  }

  async listPresets() {
    return this.mappingModel.find().sort({ updatedAt: -1 }).exec();
  }

  private async findEditableJob(id: string): Promise<ImportJobDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Import not found');
    }
    const job = await this.jobModel.findById(id).exec();
    if (!job) throw new NotFoundException('Import not found');
    if (!['UPLOADED', 'MAPPED'].includes(job.status)) {
      throw new BadRequestException(
        `Mapping can only be edited while UPLOADED/MAPPED (current: ${job.status})`,
      );
    }
    return job;
  }

  private validateMapping(
    mapping: Record<string, number>,
    job: ImportJobDocument,
  ) {
    const colCount = job.headers.length;
    for (const [field, idx] of Object.entries(mapping ?? {})) {
      if (!(IMPORT_TARGET_FIELDS as readonly string[]).includes(field)) {
        throw new BadRequestException(`Unknown mapping field "${field}"`);
      }
      if (
        typeof idx !== 'number' ||
        idx < 0 ||
        idx >= colCount ||
        !Number.isInteger(idx)
      ) {
        throw new BadRequestException(
          `Invalid column index ${idx} for field "${field}" (file has ${colCount} columns)`,
        );
      }
    }
  }
}
