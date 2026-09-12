import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from '../schemas/lead.schema';
import { LeadMessage, LeadMessageSchema } from '../schemas/lead-message.schema';
import { EmailProvider, EmailProviderSchema } from '../schemas/provider.schema';
import { Suppression, SuppressionSchema } from '../schemas/suppression.schema';
import { ImportJob, ImportJobSchema } from '../schemas/import-job.schema';
import { ImportFile, ImportFileSchema } from '../schemas/import-file.schema';
import {
  SavedMapping,
  SavedMappingSchema,
} from '../schemas/saved-mapping.schema';
import { Campaign, CampaignSchema } from '../schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientSchema,
} from '../schemas/campaign-recipient.schema';
import { EmailEvent, EmailEventSchema } from '../schemas/email-event.schema';
import { Wave, WaveSchema } from '../schemas/wave.schema';
import {
  OutreachTask,
  OutreachTaskSchema,
} from '../schemas/outreach-task.schema';
import { Playbook, PlaybookSchema } from '../schemas/playbook.schema';

/**
 * MongoDB connection + marketing schemas. Imported by both the API
 * (MarketingModule) and the marketing worker (MarketingWorkersModule).
 * This module deliberately has no dependency on Prisma/Postgres.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri =
          config.get<string>('marketing.mongoUri', {
            infer: true,
          }) ?? '';
        // A URI without a database name silently lands everything in the
        // driver's default db ("test") — a classic API/worker mismatch trap.
        const path = uri.split('?')[0];
        const dbName = path.slice(path.lastIndexOf('/') + 1);
        if (!dbName) {
          console.warn(
            '[MarketingDB] WARNING: MONGODB_URI has no database name — append one (e.g. mongodb+srv://user:pass@cluster/notaryday_marketing) or the API and worker may read different databases.',
          );
        }
        return {
          uri,
          // Boot without blocking on Mongo — connect on first query. The API
          // stays up when Mongo is down; marketing endpoints fail individually.
          lazyConnection: true,
          retryAttempts: 10,
          retryDelay: 3000,
          connectionFactory: (connection: { name?: string }) => {
            // connection.name is not populated yet under lazyConnection, so
            // log the db parsed from the URI instead.
            console.log(
              `[MarketingDB] MongoDB connected: ${dbName || '(DEFAULT DB — check MONGODB_URI!)'}`,
            );
            return connection;
          },
        };
      },
    }),
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: LeadMessage.name, schema: LeadMessageSchema },
      { name: EmailProvider.name, schema: EmailProviderSchema },
      { name: Suppression.name, schema: SuppressionSchema },
      { name: ImportJob.name, schema: ImportJobSchema },
      { name: ImportFile.name, schema: ImportFileSchema },
      { name: SavedMapping.name, schema: SavedMappingSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignRecipient.name, schema: CampaignRecipientSchema },
      { name: EmailEvent.name, schema: EmailEventSchema },
      { name: Wave.name, schema: WaveSchema },
      { name: OutreachTask.name, schema: OutreachTaskSchema },
      { name: Playbook.name, schema: PlaybookSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class MarketingDbModule {}
