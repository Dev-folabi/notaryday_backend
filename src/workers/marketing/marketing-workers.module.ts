import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_MARKETING } from '../../queues/queue.constants';
import { MarketingDbModule } from '../../modules/marketing/db/marketing-db.module';
import { EncryptionService } from '../../modules/marketing/encryption/encryption.service';
import { MailerFactory } from '../../modules/marketing/mailer/mailer.factory';
import { AudienceResolverService } from '../../modules/marketing/campaigns/audience-resolver.service';
import { MarketingProcessor } from './marketing.processor';
import { ImportIngestService } from './services/import-ingest.service';
import { SendEmailService } from './services/send-email.service';
import { WebhookEventService } from './services/webhook-event.service';
import { ConversionService } from './services/conversion.service';
import { PlaybooksService } from '../../modules/marketing/playbooks/playbooks.service';
import { MarketingSettingsService } from '../../modules/marketing/settings/marketing-settings.service';
import { DispatchTickService } from './crons/dispatch-tick.service';
import { SendTickService } from './crons/send-tick.service';
import { MaintenanceTickService } from './crons/maintenance-tick.service';
import { DigestCronService } from './crons/digest-cron.service';

/**
 * Providers for the marketing worker process. Consumes QUEUE_MARKETING
 * (imports, campaign sends, webhook events, lead conversions) and runs the
 * dispatch/send/maintenance crons + the daily digest. Mongo-only — no Prisma.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_MARKETING }),
    MarketingDbModule,
  ],
  providers: [
    EncryptionService,
    MailerFactory,
    AudienceResolverService,
    ImportIngestService,
    SendEmailService,
    WebhookEventService,
    ConversionService,
    PlaybooksService,
    MarketingSettingsService,
    MarketingProcessor,
    DispatchTickService,
    SendTickService,
    MaintenanceTickService,
    DigestCronService,
  ],
})
export class MarketingWorkersModule {}
