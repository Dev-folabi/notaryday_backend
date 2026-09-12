import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { OutreachTasksService } from './outreach-tasks.service';
import { sendCsv } from '../csv.util';

class UpdateTaskDto {
  @ApiPropertyOptional({ enum: ['TODO', 'DONE', 'SKIPPED'] })
  @IsOptional()
  @IsIn(['TODO', 'DONE', 'SKIPPED'])
  status?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

@ApiTags('Marketing Tasks')
@ApiBearerAuth()
@Controller('marketing/tasks')
@UseGuards(AuthGuard, AdminGuard)
export class OutreachTasksController {
  constructor(private readonly tasks: OutreachTasksService) {}

  @Get()
  @ApiOperation({ summary: 'Social/phone outreach tasks with lead context' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['TODO', 'DONE', 'SKIPPED'],
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    enum: ['Instagram DM', 'Facebook message', 'Phone/website'],
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const result = await this.tasks.list({
      status,
      channel,
      search,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    return { success: true, ...result };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task (status/due date/notes)' })
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return { success: true, data: await this.tasks.update(id, dto as never) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.tasks.remove(id) };
  }

  @Get('export')
  @ApiOperation({ summary: 'Export tasks as CSV' })
  async export(@Res() res: Response) {
    const rows: (string | number | null)[][] = [
      [
        'lead_id',
        'business',
        'channel',
        'status',
        'due_date',
        'completed_at',
        'notes',
        'message',
      ],
    ];
    let page = 1;
    for (;;) {
      const result = await this.tasks.list({ page, limit: 200 });
      for (const task of result.data) {
        const t = task as unknown as Record<string, string | null | undefined>;
        const lead = (t.lead ?? {}) as Record<
          string,
          string | null | undefined
        >;
        rows.push([
          lead.leadId ?? '',
          lead.businessName ?? '',
          t.channel ?? '',
          t.status ?? '',
          t.dueDate ?? '',
          t.completedAt ?? '',
          t.notes ?? '',
          t.message ?? '',
        ]);
      }
      if (page * 200 >= result.meta.total) break;
      page++;
    }
    sendCsv(res, 'outreach-tasks', rows);
  }
}
