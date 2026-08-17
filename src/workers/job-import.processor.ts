import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_JOB_IMPORT } from '../queues/queue.constants';
import { ImportStatus, SigningType } from '../../generated/prisma';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { UserSettingsService } from '../modules/users/user-settings.service';
import { EmailRendererService } from '../common/email/email-renderer.service';
import { AnalyticsService } from '../modules/analytics/analytics.service';

const PARSE_EMAIL = 'parse-email';
const PARSE_SCREENSHOT = 'parse-screenshot';

const DEFAULT_TEXT_MODEL = 'google/gemma-4-26b-a4b-it:free';
const DEFAULT_VISION_MODEL = 'google/gemma-4-26b-a4b-it:free';

interface ParsedImport {
  address?: string;
  appointment_time?: string;
  signing_type?: string;
  fee?: number;
  platform_fee?: number;
  client_name?: string;
  platform_name?: string;
  notes?: string;
}

@Processor(QUEUE_JOB_IMPORT)
export class JobImportProcessor {
  private readonly logger = new Logger(JobImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly userSettings: UserSettingsService,
    private readonly emailRenderer: EmailRendererService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Process(PARSE_EMAIL)
  async handleParseEmail(job: Job<{ importId: string }>) {
    const { importId } = job.data;
    const record = await this.prisma.jobImport.findUnique({
      where: { id: importId },
    });
    if (!record) return;

    await this.prisma.jobImport.update({
      where: { id: importId },
      data: { status: ImportStatus.PROCESSING },
    });

    try {
      // The Resend webhook is metadata-only; fetch the body when missing
      const rawText =
        record.raw_text || (await this.fetchEmailBody(record.resend_email_id));
      if (rawText && rawText !== record.raw_text) {
        await this.prisma.jobImport.update({
          where: { id: importId },
          data: { raw_text: rawText },
        });
      }

      const systemPrompt =
        'Extract signing appointment details from this email. Return JSON only with fields: address, appointment_time (ISO 8601), signing_type (GENERAL|LOAN_REFI|HYBRID|PURCHASE_CLOSING|FIELD_INSPECTION|APOSTILLE), fee (number), platform_fee (number), client_name, platform_name, notes. All fields nullable.';
      const model =
        this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ??
        DEFAULT_TEXT_MODEL;
      const parsed = await this.callAi(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawText },
        ],
        model,
      );

      await this.writeParsed(importId, parsed, record.user_id, 'email', model);
    } catch (error) {
      await this.handleError(importId, error);
    }
  }

  @Process(PARSE_SCREENSHOT)
  async handleParseScreenshot(
    job: Job<{ importId: string; fileKey: string; mimetype: string }>,
  ) {
    const { importId, fileKey, mimetype } = job.data;
    const record = await this.prisma.jobImport.findUnique({
      where: { id: importId },
    });
    if (!record) return;

    await this.prisma.jobImport.update({
      where: { id: importId },
      data: { status: ImportStatus.PROCESSING },
    });

    try {
      const imageDataUrl = await this.fetchScreenshot(fileKey, mimetype);
      const systemPrompt =
        'Extract signing appointment details from this screenshot of a signing order or booking confirmation. Return JSON only with fields: address, appointment_time (ISO 8601), signing_type (GENERAL|LOAN_REFI|HYBRID|PURCHASE_CLOSING|FIELD_INSPECTION|APOSTILLE), fee (number), platform_fee (number), client_name, platform_name, notes. All fields nullable.';
      const model =
        this.config.get<string>('OPENROUTER_VISION_MODEL') ??
        DEFAULT_VISION_MODEL;

      const parsed = await this.callAi(
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract the signing details from this image.',
              },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        model,
      );

      await this.writeParsed(
        importId,
        parsed,
        record.user_id,
        'screenshot',
        model,
      );
    } catch (error) {
      await this.handleError(importId, error);
    }
  }

  /** Shared OpenRouter call (text-only for emails, multimodal for screenshots) */
  private async callAi(
    messages: Array<Record<string, unknown>>,
    model: string,
  ): Promise<ParsedImport> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');

    const res = await axios.post<{
      choices: Array<{ message: { content: string } }>;
    }>(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages,
        temperature: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      },
    );

    const content = res.data?.choices?.[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    return JSON.parse(jsonMatch[0]) as ParsedImport;
  }

  /** Fetch a received email's body from the Resend API by its email_id */
  private async fetchEmailBody(emailId: string | null): Promise<string> {
    if (!emailId) return '';
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY is not configured');
      return '';
    }

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.receiving.get(emailId);
    if (error) {
      throw new Error(`Resend fetch failed: ${error.message}`);
    }
    return data?.text ?? data?.html ?? '';
  }

  /** Fetch a screenshot's bytes from R2 and encode as a data URL for vision AI */
  private async fetchScreenshot(
    fileKey: string,
    mimetype: string,
  ): Promise<string> {
    const r2AccountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('R2_BUCKET_NAME');

    if (!r2AccountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        'R2 credentials are not fully configured in environment variables.',
      );
    }

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
    );
    if (!result.Body) {
      throw new Error(`Screenshot not found in R2: ${fileKey}`);
    }
    const bytes = await result.Body.transformToByteArray();
    const base64 = Buffer.from(bytes).toString('base64');
    const type = mimetype || 'image/png';
    return `data:${type};base64,${base64}`;
  }

  /** Persist the parsed fields + mark COMPLETE + notify the user */
  private async writeParsed(
    importId: string,
    parsed: ParsedImport,
    userId: string,
    channel: 'email' | 'screenshot',
    model: string,
  ) {
    await this.prisma.jobImport.update({
      where: { id: importId },
      data: {
        status: ImportStatus.COMPLETE,
        parsed_address: parsed.address ?? null,
        parsed_appointment_time: parsed.appointment_time
          ? new Date(parsed.appointment_time)
          : null,
        parsed_signing_type: (parsed.signing_type as SigningType) ?? null,
        parsed_fee: parsed.fee ?? null,
        parsed_platform_fee: parsed.platform_fee ?? null,
        parsed_client_name: parsed.client_name ?? null,
        parsed_platform_name: parsed.platform_name ?? null,
        parsed_notes: parsed.notes ?? null,
        ai_model_used: model,
        processed_at: new Date(),
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const notificationConfig =
      await this.userSettings.getNotificationConfig(userId);
    if (user && notificationConfig.prefs.job_imported) {
      await this.notifications.sendPushToUser(userId, {
        title: 'Job import ready',
        body: 'Your imported job is ready for review.',
        url: `/import?review=${importId}`,
        tag: `job-import-${importId}`,
      });
      const appUrl =
        this.config.get<string>('APP_URL') || 'http://localhost:3000';
      const rendered = this.emailRenderer.render({
        title: 'Job import ready',
        subtitle:
          channel === 'email' ? 'Forwarded email parsed' : 'Screenshot parsed',
        greeting: `Hi ${user.full_name || user.username || 'Notary'},`,
        intro: 'Your import was successfully parsed and is ready for review.',
        contentHtml:
          '<p style="font-size:13px;line-height:1.7;color:#475569">Review the extracted details and confirm the job before adding it to your schedule.</p>',
        action: {
          label: 'Review import',
          url: `${appUrl}/import?review=${importId}`,
        },
        plainText: `Your ${channel === 'email' ? 'forwarded email' : 'uploaded screenshot'} was parsed. Review it at ${appUrl}/import?review=${importId}.`,
      });
      await this.notifications.sendNotificationEmail({
        to: user.email,
        subject: 'Your job import is ready for review',
        html: rendered.html,
        text: rendered.text,
      });
    }

    this.logger.log(`Job import ${importId} parsed successfully (${channel})`);
    this.analytics.track('job_import_completed', userId, {
      channel,
      model,
    });
  }
  /** Mark an import FAILED and log the error */
  private async handleError(importId: string, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Job import ${importId} failed: ${errorMessage}`);
    await this.prisma.jobImport.update({
      where: { id: importId },
      data: {
        status: ImportStatus.FAILED,
        error_message: errorMessage,
        processed_at: new Date(),
      },
    });

    const importRecord = await this.prisma.jobImport.findUnique({
      where: { id: importId },
      select: { user_id: true },
    });
    if (!importRecord) return;
    const user = await this.prisma.user.findUnique({
      where: { id: importRecord.user_id },
    });
    const config = await this.userSettings.getNotificationConfig(
      importRecord.user_id,
    );
    if (!user || !config.prefs.import_failed) return;

    await this.notifications.sendPushToUser(importRecord.user_id, {
      title: 'Import failed',
      body: 'An import could not be parsed. Tap to enter the job manually.',
      url: '/jobs/new',
      tag: `import-failed-${importId}`,
    });
    const rendered = this.emailRenderer.render({
      title: 'Import failed',
      subtitle: 'Manual review needed',
      greeting: `Hi ${user.full_name || user.username || 'Notary'},`,
      intro: 'We could not automatically parse this import.',
      contentHtml:
        '<p style="font-size:13px;line-height:1.7;color:#475569">You can enter the signing details manually and add the job to your schedule.</p>',
      action: {
        label: 'Enter job manually',
        url: `${this.config.get<string>('APP_URL') || 'http://localhost:3000'}/jobs/new`,
      },
      plainText:
        'We could not automatically parse this import. Enter the job manually to add it to your schedule.',
    });
    await this.notifications.sendNotificationEmail({
      to: user.email,
      subject: 'Your job import needs manual review',
      html: rendered.html,
      text: rendered.text,
    });
  }
}
