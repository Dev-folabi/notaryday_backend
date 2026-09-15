import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { IsBoolean, IsOptional } from 'class-validator';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { LeadsService } from './leads.service';
import { sendCsv } from '../csv.util';
import {
  CreateLeadDto,
  UpdateLeadDto,
  UpdateLeadMessageDto,
} from '../dto/lead.dto';

class ForceOverwriteDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@ApiTags('Marketing Leads')
@ApiBearerAuth()
@Controller('marketing/leads')
@UseGuards(AuthGuard, AdminGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get('stats/overview')
  @ApiOperation({
    summary: 'Lead counts by tier / wave / status / AB group / channel',
  })
  @ApiResponse({ status: 200, description: 'Lead stats' })
  async stats() {
    return { success: true, data: await this.leads.stats() };
  }

  @Get('export')
  @ApiOperation({
    summary:
      'Export leads as CSV (AB-test tracker style, with live engagement)',
  })
  async export(
    @Res() res: Response,
    @Query('tier') tier?: string,
    @Query('wave') wave?: string,
    @Query('state') state?: string,
    @Query('abGroup') abGroup?: string,
    @Query('status') status?: string,
  ) {
    const rows = await this.leads.exportCsv({
      tier,
      wave,
      state,
      abGroup,
      status,
    });
    sendCsv(res, 'notaryday-leads', rows);
  }

  @Get()
  @ApiOperation({ summary: 'List leads with filters & pagination' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'tier', required: false, enum: ['A_PLUS', 'A', 'B', 'C'] })
  @ApiQuery({
    name: 'wave',
    required: false,
    enum: ['WAVE_1', 'WAVE_2', 'WAVE_3', 'SOCIAL_PHONE', 'EXCLUDED'],
  })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'abGroup', required: false, enum: ['A', 'B'] })
  @ApiQuery({ name: 'channel', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'hasEmail', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'excluded', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'inSequence', required: false, enum: ['true', 'false'] })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['newest', 'oldest', 'name', 'score', 'tier'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('search') search?: string,
    @Query('tier') tier?: string,
    @Query('wave') wave?: string,
    @Query('state') state?: string,
    @Query('abGroup') abGroup?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('hasEmail') hasEmail?: 'true' | 'false',
    @Query('excluded') excluded?: 'true' | 'false',
    @Query('inSequence') inSequence?: 'true' | 'false',
    @Query('sort') sort?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const result = await this.leads.list({
      search,
      tier,
      wave,
      state,
      abGroup,
      channel,
      status,
      hasEmail,
      excluded,
      inSequence,
      sort,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    return { success: true, ...result };
  }

  @Post()
  @ApiOperation({ summary: 'Create a lead manually' })
  async create(@Body() dto: CreateLeadDto) {
    return { success: true, data: await this.leads.create(dto as never) };
  }

  @Patch('bulk')
  @ApiOperation({ summary: 'Bulk actions on selected leads' })
  async bulk(
    @Body()
    dto: {
      ids: string[];
      action: string;
      value?: string;
    },
  ) {
    return {
      success: true,
      data: await this.leads.bulk(dto.ids, dto.action, dto.value),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Lead detail with messages, suppression state and per-step send progress',
  })
  @ApiResponse({ status: 200, description: 'Lead detail' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async detail(@Param('id') id: string) {
    const { lead, suppression } = await this.leads.detail(id);
    const [messages, stepProgress] = await Promise.all([
      this.leads.listMessages(id),
      this.leads.stepProgress(id),
    ]);
    return {
      success: true,
      data: { lead, messages, suppression, stepProgress },
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit any lead field' })
  async update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return { success: true, data: await this.leads.update(id, dto as never) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a lead (and its messages)' })
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.leads.remove(id) };
  }

  @Get(':id/messages')
  @ApiOperation({ summary: "List a lead's sequence messages (steps 1-9 + DM)" })
  async listMessages(@Param('id') id: string) {
    return {
      success: true,
      data: await this.leads.listMessages(id),
    };
  }

  @Patch(':id/messages/:step')
  @ApiOperation({
    summary: 'Edit (upsert) a lead message by step — 1..9 email, 10 DM',
  })
  async updateMessage(
    @Param('id') id: string,
    @Param('step', ParseIntPipe) step: number,
    @Body() dto: UpdateLeadMessageDto,
    @Query() forceDto: ForceOverwriteDto,
  ) {
    return {
      success: true,
      data: await this.leads.updateMessage(id, step, dto, forceDto.force),
    };
  }
}
