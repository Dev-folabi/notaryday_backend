import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EmailProvider,
  EmailProviderDocument,
} from '../../../modules/marketing/schemas/provider.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
} from '../../../modules/marketing/schemas/campaign-recipient.schema';
import {
  EmailEvent,
  EmailEventDocument,
} from '../../../modules/marketing/schemas/email-event.schema';
import {
  Suppression,
  SuppressionDocument,
} from '../../../modules/marketing/schemas/suppression.schema';
import { EncryptionService } from '../../../modules/marketing/encryption/encryption.service';
import { MailerFactory } from '../../../modules/marketing/mailer/mailer.factory';

/** Daily 08:00 UTC digest of yesterday's marketing activity → ADMIN_EMAIL. */
@Injectable()
export class DigestCronService {
  private readonly logger = new Logger(DigestCronService.name);

  constructor(
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
    @InjectModel(Suppression.name)
    private readonly suppressionModel: Model<SuppressionDocument>,
    private readonly encryption: EncryptionService,
    private readonly mailerFactory: MailerFactory,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 8 * * *')
  async tick(): Promise<void> {
    try {
      const now = new Date();
      const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const start = new Date(end.getTime() - 86_400_000);

      const [
        sent,
        failed,
        opened,
        clicked,
        unsubscribed,
        bounced,
        newSuppressions,
        queued,
      ] = await Promise.all([
        this.recipientModel.countDocuments({
          sentAt: { $gte: start, $lt: end },
        }),
        this.eventModel.countDocuments({
          type: 'FAILED',
          createdAt: { $gte: start, $lt: end },
        }),
        this.eventModel.countDocuments({
          type: 'OPENED',
          createdAt: { $gte: start, $lt: end },
        }),
        this.eventModel.countDocuments({
          type: 'CLICKED',
          createdAt: { $gte: start, $lt: end },
        }),
        this.eventModel.countDocuments({
          type: 'UNSUBSCRIBED',
          createdAt: { $gte: start, $lt: end },
        }),
        this.eventModel.countDocuments({
          type: 'BOUNCED',
          createdAt: { $gte: start, $lt: end },
        }),
        this.suppressionModel.countDocuments({
          createdAt: { $gte: start, $lt: end },
        }),
        this.recipientModel.countDocuments({ status: 'QUEUED' }),
      ]);

      const adminEmail = this.config.get<string>('ADMIN_EMAIL');
      const provider =
        (await this.providerModel
          .findOne({ isDefault: true, status: 'ACTIVE' })
          .exec()) ??
        (await this.providerModel.findOne({ status: 'ACTIVE' }).exec());
      if (!adminEmail || !provider) {
        this.logger.log(
          'Digest skipped (no ADMIN_EMAIL or no active provider with credentials)',
        );
        return;
      }

      const pct = (n: number, d: number) =>
        d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
      const text = [
        'NotaryDay marketing digest — yesterday (UTC)',
        '',
        `Sent:        ${sent}`,
        `Failed:      ${failed}`,
        `Opened:      ${opened} (${pct(opened, sent)} of sent)`,
        `Clicked:     ${clicked} (${pct(clicked, sent)} of sent)`,
        `Unsubscribed: ${unsubscribed}`,
        `Bounced:     ${bounced}`,
        `New suppressions: ${newSuppressions}`,
        '',
        `Currently queued sends: ${queued}`,
        '',
        `— via ${provider.name} (${provider.type})`,
      ].join('\n');

      const mailer = this.mailerFactory.build(
        provider.type as never,
        this.encryption.decrypt<Record<string, string>>(
          provider.credentialsEncrypted,
        ),
      );
      await mailer.send({
        to: adminEmail,
        subject: `NotaryDay marketing digest — ${start.toISOString().slice(0, 10)}`,
        text,
        html: `<pre style="font-family:ui-monospace,monospace;font-size:13px">${text.replace(/</g, '&lt;')}</pre>`,
        fromName: provider.fromName,
        fromEmail: provider.fromEmail,
      });
      this.logger.log(`Digest sent to ${adminEmail}`);
    } catch (error) {
      this.logger.error(
        `Digest failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
