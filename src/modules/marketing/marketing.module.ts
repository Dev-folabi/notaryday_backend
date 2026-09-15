import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QUEUE_MARKETING } from '../../queues/queue.constants';
import { MarketingDbModule } from './db/marketing-db.module';
import { EncryptionService } from './encryption/encryption.service';
import { MailerFactory } from './mailer/mailer.factory';
import { LeadsController } from './leads/leads.controller';
import { LeadsService } from './leads/leads.service';
import { ProvidersController } from './providers/providers.controller';
import { ProvidersService } from './providers/providers.service';
import { ImportsController } from './imports/imports.controller';
import { ImportsService } from './imports/imports.service';
import { MarketingOverviewController } from './marketing-overview.controller';
import { AudienceResolverService } from './campaigns/audience-resolver.service';
import { CampaignsService } from './campaigns/campaigns.service';
import { CampaignsController } from './campaigns/campaigns.controller';
import { DirectSendService } from './campaigns/direct-send.service';
import { DirectSendController } from './campaigns/direct-send.controller';
import { SuppressService } from './suppressions/suppress.service';
import { SuppressController } from './suppressions/suppress.controller';
import { TrackingService } from './tracking/tracking.service';
import { TrackingController } from './tracking/tracking.controller';
import { WebhooksController } from './webhooks/webhooks.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { WavesService } from './waves/waves.service';
import { WavesController } from './waves/waves.controller';
import { OutreachTasksService } from './tasks/outreach-tasks.service';
import { OutreachTasksController } from './tasks/outreach-tasks.controller';
import { PlaybooksService } from './playbooks/playbooks.service';
import { PlaybooksController } from './playbooks/playbooks.controller';
import { MarketingHealthController } from './marketing-health.controller';
import { MarketingSettingsController } from './settings/marketing-settings.controller';
import { MarketingSettingsService } from './settings/marketing-settings.service';

/**
 * Admin-facing marketing/CRM module (MongoDB-backed).
 * Heavy processing (bulk imports, campaign sends, webhook events) runs in
 * the separate marketing worker via QUEUE_MARKETING.
 */
@Module({
  imports: [
    MarketingDbModule,
    BullModule.registerQueue({ name: QUEUE_MARKETING }),
  ],
  controllers: [
    MarketingOverviewController,
    LeadsController,
    ProvidersController,
    ImportsController,
    CampaignsController,
    DirectSendController,
    SuppressController,
    TrackingController,
    WebhooksController,
    AnalyticsController,
    WavesController,
    OutreachTasksController,
    PlaybooksController,
    MarketingHealthController,
    MarketingSettingsController,
  ],
  providers: [
    EncryptionService,
    MailerFactory,
    LeadsService,
    ProvidersService,
    ImportsService,
    AudienceResolverService,
    CampaignsService,
    DirectSendService,
    SuppressService,
    TrackingService,
    AnalyticsService,
    WavesService,
    OutreachTasksService,
    PlaybooksService,
    MarketingSettingsService,
  ],
  exports: [LeadsService, EncryptionService, MailerFactory],
})
export class MarketingModule {}
