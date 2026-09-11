import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import {
  Lead,
  LeadDocument,
} from '../../../modules/marketing/schemas/lead.schema';
import {
  LeadMessage,
  LeadMessageDocument,
} from '../../../modules/marketing/schemas/lead-message.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../../../modules/marketing/schemas/suppression.schema';
import {
  ImportJob,
  ImportJobDocument,
  ImportRowError,
} from '../../../modules/marketing/schemas/import-job.schema';
import {
  ImportFile,
  ImportFileDocument,
} from '../../../modules/marketing/schemas/import-file.schema';
import {
  OutreachTask,
  OutreachTaskDocument,
} from '../../../modules/marketing/schemas/outreach-task.schema';
import {
  parseSpreadsheet,
  parseAllSheets,
} from '../../../modules/marketing/imports/spreadsheet.util';
import {
  dayOffsetFromHeader,
  mapAbGroup,
  mapBoolean,
  mapFitTier,
  mapWaveKey,
  parseSequenceEmailCell,
  sanitizeEmail,
} from '../../../modules/marketing/imports/lead-ingest.util';
import { PlaybooksService } from '../../../modules/marketing/playbooks/playbooks.service';

interface StagedMessage {
  step: number;
  kind: 'EMAIL' | 'DM';
  subject: string;
  body: string;
  dayOffset?: number;
}

interface StagedRow {
  rowNumber: number;
  leadId?: string;
  email?: string;
  businessName?: string;
  doc: Record<string, unknown>;
  messages: StagedMessage[];
}

const BATCH_SIZE = 500;
const LOOKUP_CHUNK = 1000;
const MAX_ROW_ERRORS = 100;
const DM_STEP = 10;
const TASK_CHANNELS = ['Instagram DM', 'Facebook message', 'Phone/website'];

@Injectable()
export class ImportIngestService {
  private readonly logger = new Logger(ImportIngestService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(LeadMessage.name)
    private readonly messageModel: Model<LeadMessageDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
    @InjectModel(ImportJob.name)
    private readonly jobModel: Model<ImportJobDocument>,
    @InjectModel(ImportFile.name)
    private readonly fileModel: Model<ImportFileDocument>,
    @InjectModel(OutreachTask.name)
    private readonly taskModel: Model<OutreachTaskDocument>,
    private readonly playbooks: PlaybooksService,
  ) {}

  async runImport(importId: string) {
    const importJob = await this.jobModel.findById(importId).exec();
    if (!importJob) {
      this.logger.error(
        `Import job ${importId} not found in this worker's MongoDB — the API and worker are likely pointing at different databases. ` +
          'Check MONGODB_URI (it must include the database name, e.g. mongodb+srv://user:pass@cluster/notaryday_marketing).',
      );
      return;
    }
    // Already finished — a duplicate job (e.g. a requeue racing the original)
    if (['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(importJob.status)) {
      this.logger.log(
        `Import ${importId} already ${importJob.status}; skipping`,
      );
      return;
    }
    // Actively processing on another worker right now — skip duplicates
    if (importJob.status === 'PROCESSING' && importJob.startedAt) {
      const ageMs = Date.now() - new Date(importJob.startedAt).getTime();
      if (ageMs < 10 * 60_000) {
        this.logger.warn(
          `Import ${importId} is already PROCESSING (started ${Math.round(ageMs / 1000)}s ago); skipping duplicate job`,
        );
        return;
      }
    }
    if (!importJob.fileRef) {
      await this.jobModel
        .updateOne(
          { _id: importJob._id },
          {
            $set: {
              status: 'FAILED',
              error: 'No file attached',
              completedAt: new Date(),
            },
          },
        )
        .exec();
      return;
    }

    await this.jobModel
      .updateOne(
        { _id: importJob._id },
        { $set: { status: 'PROCESSING', startedAt: new Date(), error: null } },
      )
      .exec();
    this.logger.log(`Importing "${importJob.filename}" (${importId})…`);

    try {
      const file = await this.fileModel.findById(importJob.fileRef).exec();
      if (!file?.data) {
        throw new Error('Stored file could not be read');
      }

      const buffer = Buffer.from(file.data);
      const sheet = await parseSpreadsheet(buffer, file.filename);
      const counts = await this.ingest(importJob, sheet);

      // Aux sheets: seed playbooks from an Outreach_Playbook sheet if present
      try {
        const allSheets = await parseAllSheets(buffer, file.filename);
        for (const s of allSheets.slice(1)) {
          const header = (s.rows[0] ?? [])
            .map((h) => h.toLowerCase())
            .join('|');
          if (header.includes('signal') && header.includes('angle')) {
            await this.playbooks.ingestFromSheet(s.rows);
            break;
          }
        }
      } catch (error) {
        this.logger.warn(
          `Playbook ingestion skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const status =
        counts.errorCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
      await this.jobModel
        .updateOne(
          { _id: importJob._id },
          {
            $set: {
              status,
              totalRows: counts.totalRows,
              importedCount: counts.importedCount,
              updatedCount: counts.updatedCount,
              duplicateCount: counts.duplicateCount,
              skippedCount: counts.skippedCount,
              errorCount: counts.errorCount,
              rowErrors: counts.rowErrors,
              completedAt: new Date(),
            },
          },
        )
        .exec();

      this.logger.log(
        `Import ${importId} done: ${counts.importedCount} new, ` +
          `${counts.updatedCount} updated, ${counts.duplicateCount} dupes, ` +
          `${counts.skippedCount} skipped, ${counts.errorCount} errors`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Import ${importId} failed: ${message}`);
      await this.jobModel
        .updateOne(
          { _id: importJob._id },
          {
            $set: {
              status: 'FAILED',
              error: message.slice(0, 1000),
              completedAt: new Date(),
            },
          },
        )
        .exec();
      throw error;
    }
  }

  private async ingest(
    importJob: ImportJobDocument,
    sheet: { headers: string[]; rows: string[][] },
  ) {
    const mapping = importJob.mapping ?? {};

    const get = (row: string[], field: string): string | undefined => {
      const idx = mapping[field];
      if (idx === undefined || idx === null || idx >= row.length) {
        return undefined;
      }
      const value = row[idx];
      return value === undefined || value === '' ? undefined : value;
    };

    const totalRows = sheet.rows.length;
    let duplicateCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const rowErrors: ImportRowError[] = [];
    const staged: StagedRow[] = [];

    // ---- Pass 1: stage & validate rows ----
    const seenLeadIds = new Set<string>();
    const seenEmails = new Set<string>();

    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      const rowNumber = r + 2; // header + 1-based

      const leadId = get(row, 'leadId');
      const email = sanitizeEmail(get(row, 'email'));
      const businessName = get(row, 'businessName');

      if (!leadId && !email && !businessName) {
        errorCount++;
        if (rowErrors.length < MAX_ROW_ERRORS) {
          rowErrors.push({
            row: rowNumber,
            error: 'Row has no lead id, email, or business name',
          });
        }
        continue;
      }

      // In-file duplicate detection (by leadId, else by email)
      const dupeKey = leadId ?? (email ? `em:${email}` : null);
      if (dupeKey && (seenLeadIds.has(dupeKey) || seenEmails.has(dupeKey))) {
        duplicateCount++;
        continue;
      }
      if (leadId) seenLeadIds.add(leadId);
      if (email) seenEmails.add(email);

      if (importJob.options?.skipNoEmail && !email) {
        skippedCount++;
        continue;
      }

      const campaignWave = get(row, 'campaignWave');
      const excludeFromSend = mapBoolean(get(row, 'excludeFromSend'));
      const fitTier = mapFitTier(get(row, 'fitTier'));
      const waveKey = mapWaveKey(campaignWave) ?? undefined;

      const doc: Record<string, unknown> = {
        leadId: leadId || undefined,
        fitTier: fitTier ?? undefined,
        prospectScore: toNumber(get(row, 'prospectScore')),
        businessName: businessName || undefined,
        professionalName: get(row, 'professionalName'),
        website: get(row, 'website'),
        email: email || undefined,
        emailVerification: get(row, 'emailVerification'),
        phone: get(row, 'phone'),
        facebookUrl: get(row, 'facebookUrl'),
        instagramUrl: get(row, 'instagramUrl'),
        address: get(row, 'address'),
        city: get(row, 'city'),
        state: get(row, 'state')?.toUpperCase(),
        qualificationEvidence: get(row, 'qualificationEvidence'),
        bestAngle: get(row, 'bestAngle'),
        personalizationHook: get(row, 'personalizationHook'),
        recommendedChannel: get(row, 'recommendedChannel'),
        emailSubject: get(row, 'emailSubject'),
        verificationStatus: get(row, 'verificationStatus'),
        excludeFromSend,
        campaignWave,
        waveKey,
        abGroup: mapAbGroup(get(row, 'abGroup')) ?? undefined,
        sourceImport: importJob._id,
      };

      const messages: StagedMessage[] = [];
      for (let step = 1; step <= 9; step++) {
        const cell = get(row, `email${step}`);
        if (!cell) continue;
        const parsed = parseSequenceEmailCell(cell);
        if (!parsed.subject && !parsed.body) continue;
        messages.push({
          step,
          kind: 'EMAIL',
          subject: parsed.subject,
          body: parsed.body,
          dayOffset: dayOffsetFromHeader(
            sheet.headers[mapping[`email${step}`]],
            step,
          ),
        });
      }
      const dmCell = get(row, 'dmMessage');
      if (dmCell) {
        messages.push({
          step: DM_STEP,
          kind: 'DM',
          subject: '',
          body: dmCell,
        });
      }

      staged.push({
        rowNumber,
        leadId,
        email: email ?? undefined,
        businessName,
        doc,
        messages,
      });
    }

    // ---- Resolve existing leads (bulk lookups) ----
    const leadIds = staged.map((s) => s.leadId).filter(Boolean) as string[];
    const emails = staged.map((s) => s.email).filter(Boolean) as string[];
    const businessNames = staged
      .map((s) => (s.leadId || s.email ? null : s.businessName))
      .filter(Boolean) as string[];

    const existing = new Map<string, Types.ObjectId>();
    await collectExisting(existing, 'id', this.leadModel, 'leadId', leadIds);
    await collectExisting(existing, 'em', this.leadModel, 'email', emails);
    await collectExisting(
      existing,
      'bn',
      this.leadModel,
      'businessName',
      businessNames,
    );

    const keyFor = (s: StagedRow): string | null => {
      if (s.leadId) return `id:${s.leadId}`;
      if (s.email) return `em:${s.email}`;
      if (s.businessName) return `bn:${s.businessName}`;
      return null;
    };

    // ---- Suppressions ----
    const suppressedEmails = new Set<string>();
    if (emails.length > 0) {
      for (let i = 0; i < emails.length; i += LOOKUP_CHUNK) {
        const chunk = [...new Set(emails.slice(i, i + LOOKUP_CHUNK))];
        const found = await this.suppressionModel
          .find({ email: { $in: chunk } })
          .select('email')
          .lean<{ email: string }[]>()
          .exec();
        for (const doc of found) suppressedEmails.add(doc.email);
      }
    }

    // ---- Pass 2: bulk upsert leads ----
    let importedCount = 0;
    let updatedCount = 0;
    for (let i = 0; i < staged.length; i += BATCH_SIZE) {
      const batch = staged.slice(i, i + BATCH_SIZE);
      const ops = batch.map((s) => {
        const doc = cleanUndefined(s.doc);
        const key = keyFor(s);
        const existingId = key ? existing.get(key) : undefined;

        if (existingId) {
          updatedCount++;
          return {
            updateOne: {
              filter: { _id: existingId },
              update: { $set: doc },
            },
          };
        }

        importedCount++;
        const initialStatus = doc.excludeFromSend
          ? 'EXCLUDED'
          : s.email && suppressedEmails.has(s.email)
            ? 'UNSUBSCRIBED'
            : doc.fitTier === 'C'
              ? 'NEEDS_VERIFICATION'
              : 'NEW';
        const filter: Record<string, unknown> = {};
        if (s.leadId) filter.leadId = s.leadId;
        else if (s.email) filter.email = s.email;
        else if (s.businessName) filter.businessName = s.businessName;

        return {
          updateOne: {
            filter,
            update: {
              $setOnInsert: {
                ...doc,
                status: initialStatus,
                unsubToken: randomBytes(12).toString('hex'),
              },
            },
            upsert: true,
          },
        };
      });
      if (ops.length > 0) {
        await this.leadModel.bulkWrite(ops, { ordered: false });
      }
    }

    // ---- Pass 3: re-resolve ids for newly inserted leads, then insert messages ----
    const unresolvedKeys = new Set(
      staged
        .filter((s) => {
          const key = keyFor(s);
          return key && !existing.has(key);
        })
        .map((s) => keyFor(s)!)
        .filter((k) => !k.startsWith('bn:')),
    );
    if (unresolvedKeys.size > 0) {
      const newIds = [...unresolvedKeys]
        .filter((k) => k.startsWith('id:'))
        .map((k) => k.slice(3));
      const newEmails = [...unresolvedKeys]
        .filter((k) => k.startsWith('em:'))
        .map((k) => k.slice(3));
      await collectExisting(existing, 'id', this.leadModel, 'leadId', newIds);
      await collectExisting(existing, 'em', this.leadModel, 'email', newEmails);
    }

    const messageOps: ReturnType<typeof buildMessageOp>[] = [];
    const taskOps: Record<string, unknown>[] = [];
    for (const s of staged) {
      const key = keyFor(s);
      const leadRef = key ? existing.get(key) : undefined;
      if (!leadRef) continue;
      for (const m of s.messages) {
        messageOps.push(buildMessageOp(leadRef, s.leadId, m));
      }
      // Social/phone track: auto-create an outreach task pre-filled with the DM
      const dmMessage = s.messages.find((m) => m.step === DM_STEP)?.body ?? '';
      const channel = (s.doc.recommendedChannel as string | undefined) ?? '';
      if (
        channel &&
        channel !== 'Email' &&
        TASK_CHANNELS.includes(channel as never)
      ) {
        taskOps.push({
          updateOne: {
            filter: { leadRef, channel },
            update: {
              $setOnInsert: {
                leadRef,
                channel,
                status: 'TODO',
                message: dmMessage,
                sourceImport: importJob._id,
              },
            },
            upsert: true,
          },
        });
      }
    }
    for (let i = 0; i < messageOps.length; i += BATCH_SIZE) {
      await this.messageModel.bulkWrite(
        messageOps.slice(i, i + BATCH_SIZE) as never,
        { ordered: false },
      );
    }
    for (let i = 0; i < taskOps.length; i += BATCH_SIZE) {
      await this.taskModel.bulkWrite(
        taskOps.slice(i, i + BATCH_SIZE) as never,
        { ordered: false },
      );
    }

    return {
      totalRows,
      importedCount,
      updatedCount,
      duplicateCount,
      skippedCount,
      errorCount,
      rowErrors,
    };
  }
}

function buildMessageOp(
  leadRef: Types.ObjectId,
  leadId: string | undefined,
  m: StagedMessage,
) {
  return {
    updateOne: {
      filter: { leadRef, step: m.step },
      update: {
        $setOnInsert: {
          leadRef,
          leadId: leadId ?? undefined,
          step: m.step,
          kind: m.kind,
          subject: m.subject,
          body: m.body,
          dayOffset: m.dayOffset ?? undefined,
          edited: false,
        },
      },
      upsert: true,
    },
  };
}

async function collectExisting(
  map: Map<string, Types.ObjectId>,
  prefix: 'id' | 'em' | 'bn',
  model: Model<LeadDocument>,
  field: 'leadId' | 'email' | 'businessName',
  values: string[],
) {
  const unique = [...new Set(values.filter(Boolean))];
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const found = await model
      .find({ [field]: { $in: chunk } })
      .select(field)
      .lean<{ _id: Types.ObjectId; [k: string]: unknown }[]>()
      .exec();
    for (const doc of found) {
      const value = doc[field];
      if (typeof value === 'string') {
        const key = `${prefix}:${value}`;
        if (!map.has(key)) map.set(key, doc._id);
      }
    }
  }
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function cleanUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
