import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_EMAIL_IMPORT } from '../queues/queue.constants';
import { ImportStatus, SigningType } from '../../generated/prisma';
import { NotificationsService } from '../modules/notifications/notifications.service';

@Processor(QUEUE_EMAIL_IMPORT)
export class EmailImportProcessor {
  private readonly logger = new Logger(EmailImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  @Process('parse-email')
  async handleParse(job: Job<{ importId: string }>) {
    const { importId } = job.data;
    const record = await this.prisma.emailImport.findUnique({
      where: { id: importId },
    });
    if (!record) return;

    await this.prisma.emailImport.update({
      where: { id: importId },
      data: { status: ImportStatus.PROCESSING },
    });

    try {
      const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
      const model =
        this.config.get<string>('OPENROUTER_MODEL') ??
        'mistralai/mistral-7b-instruct:free';

      const res = await axios.post<{
        choices: Array<{ message: { content: string } }>;
      }>(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'Extract signing appointment details from this email. Return JSON only with fields: address, appointment_time (ISO 8601), signing_type (GENERAL|LOAN_REFI|HYBRID|PURCHASE_CLOSING|FIELD_INSPECTION|APOSTILLE), fee (number), platform_fee (number), client_name, platform_name, notes. All fields nullable.',
            },
            { role: 'user', content: record.raw_text },
          ],
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

      const parsed = JSON.parse(jsonMatch[0]) as {
        address?: string;
        appointment_time?: string;
        signing_type?: string;
        fee?: number;
        platform_fee?: number;
        client_name?: string;
        platform_name?: string;
        notes?: string;
      };

      await this.prisma.emailImport.update({
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
        where: { id: record.user_id },
      });

      if (user) {
        const appUrl =
          this.config.get<string>('APP_URL') || 'http://localhost:3000';
        await this.notifications.sendNotificationEmail({
          to: user.email,
          subject: 'Your email import is ready for review',
          html: `
            <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #0F2C4E;">Email Import Ready</h1>
              <p>Hi ${user.full_name || user.username || 'Notary'},</p>
              <p>Your forwarded email has been successfully parsed by Notary Day.</p>
              <p>Please log in to review the details and confirm the signing job.</p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${appUrl}/imports" style="background-color: #0F2C4E; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  Review Import
                </a>
              </div>
            </div>
          `,
        });
      }

      this.logger.log(`Email import ${importId} parsed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Email import ${importId} failed: ${errorMessage}`);
      await this.prisma.emailImport.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          error_message: errorMessage,
          processed_at: new Date(),
        },
      });
    }
  }
}
