import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CampaignsService } from './campaigns.service';
import { sendCsv } from '../csv.util';
import {
  CreateCampaignDto,
  PreviewCampaignDto,
  ScheduleCampaignDto,
  UpdateCampaignDto,
} from '../dto/campaign.dto';

class RecipientSearchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  step?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  page?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

@ApiTags('Marketing Campaigns')
@ApiBearerAuth()
@Controller('marketing/campaigns')
@UseGuards(AuthGuard, AdminGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post('preview')
  @ApiOperation({
    summary:
      'Preview an audience (suppression/exclusion aware counts) without saving',
  })
  async preview(@Body() dto: PreviewCampaignDto) {
    return {
      success: true,
      data: await this.campaigns.preview(dto as never),
    };
  }

  @Get()
  @ApiOperation({ summary: 'List campaigns with recipient stats' })
  async list() {
    return { success: true, data: await this.campaigns.list() };
  }

  @Post()
  @ApiOperation({ summary: 'Create a campaign (DRAFT)' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCampaignDto,
  ) {
    return { success: true, data: await this.campaigns.create(dto, userId) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Campaign detail with stats (monitor view)' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  async detail(@Param('id') id: string) {
    return { success: true, data: await this.campaigns.detail(id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a DRAFT campaign' })
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return { success: true, data: await this.campaigns.update(id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a DRAFT campaign' })
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.campaigns.remove(id) };
  }

  @Post(':id/schedule')
  @ApiOperation({
    summary:
      'Schedule a DRAFT campaign — the marketing worker dispatches it at startAt',
  })
  async schedule(@Param('id') id: string, @Body() dto: ScheduleCampaignDto) {
    return {
      success: true,
      data: await this.campaigns.schedule(id, dto.startAt),
    };
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a RUNNING campaign' })
  async pause(@Param('id') id: string) {
    return { success: true, data: await this.campaigns.pause(id) };
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a PAUSED campaign' })
  async resume(@Param('id') id: string) {
    return { success: true, data: await this.campaigns.resume(id) };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a scheduled/running campaign' })
  async cancel(@Param('id') id: string) {
    return { success: true, data: await this.campaigns.cancel(id) };
  }

  @Get(':id/recipients/export')
  @ApiOperation({ summary: 'Export a campaign recipients grid as CSV' })
  async exportRecipients(@Param('id') id: string, @Res() res: Response) {
    const rows = await this.campaigns.exportRecipientsCsv(id);
    sendCsv(res, `campaign-${id}-recipients`, rows);
  }

  @Get(':id/recipients')
  @ApiOperation({ summary: 'Recipients grid for the monitor view' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'step', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async recipients(
    @Param('id') id: string,
    @Query() query: RecipientSearchDto,
  ) {
    const result = await this.campaigns.recipients(id, {
      status: query.status,
      search: query.search,
      step: query.step,
      page: query.page ?? 1,
      limit: query.limit ?? 25,
    });
    return { success: true, ...result };
  }
}
