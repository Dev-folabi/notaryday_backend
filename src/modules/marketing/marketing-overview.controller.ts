import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ImportJob, ImportJobDocument } from './schemas/import-job.schema';
import {
  EmailProvider,
  EmailProviderDocument,
} from './schemas/provider.schema';
import { LeadsService } from './leads/leads.service';

@ApiTags('Marketing Overview')
@ApiBearerAuth()
@Controller('marketing')
@UseGuards(AuthGuard, AdminGuard)
export class MarketingOverviewController {
  constructor(
    private readonly leadsService: LeadsService,
    @InjectModel(ImportJob.name)
    private readonly importModel: Model<ImportJobDocument>,
    @InjectModel(EmailProvider.name)
    private readonly providerModel: Model<EmailProviderDocument>,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Marketing dashboard overview' })
  async overview() {
    const [leadStats, recentImports, providers] = await Promise.all([
      this.leadsService.stats(),
      this.importModel
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select(
          'filename status totalRows importedCount updatedCount duplicateCount errorCount createdAt',
        )
        .exec(),
      this.providerModel
        .find()
        .select(
          'name type status isDefault healthLastSuccessAt healthLastError sentToday dailyLimit',
        )
        .exec(),
    ]);

    return {
      success: true,
      data: {
        leadStats,
        recentImports,
        providers,
      },
    };
  }
}
