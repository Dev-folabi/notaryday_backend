import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlanGuard } from '../../common/guards/plan.guard';
import { RequiresPro } from '../../common/decorators/requires-pro.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import {
  CreateMileageEntryDto,
  UpdateMileageEntryDto,
  UpdateJobMileageDto,
} from './dto/mileage-entry.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(AuthGuard, PlanGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('earnings')
  @RequiresPro()
  @ApiOperation({ summary: 'Get earnings report for a date range' })
  @ApiQuery({
    name: 'from',
    required: true,
    example: '2025-01-01',
    description: 'Start date',
  })
  @ApiQuery({
    name: 'to',
    required: true,
    example: '2025-06-30',
    description: 'End date',
  })
  @ApiQuery({
    name: 'group_by',
    required: false,
    enum: ['week', 'month'],
    description: 'Group results by period',
  })
  @ApiQuery({
    name: 'compare',
    required: false,
    enum: ['true', 'false'],
    description: 'Return YoY comparison vs the same period last year',
  })
  @ApiResponse({ status: 200, description: 'Earnings data grouped by period' })
  async earnings(
    @CurrentUser('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('group_by') groupBy?: 'week' | 'month',
    @Query('compare') compare?: string,
  ) {
    return {
      success: true,
      data: await this.reports.earnings(
        userId,
        from,
        to,
        groupBy,
        compare === 'true',
      ),
    };
  }

  @Post('mileage')
  @RequiresPro()
  @ApiOperation({ summary: 'Add a manual mileage entry' })
  @ApiResponse({ status: 201, description: 'Mileage entry created' })
  async createMileageEntry(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateMileageEntryDto,
  ) {
    return {
      success: true,
      data: await this.reports.createMileageEntry(userId, dto),
    };
  }

  @Patch('mileage/:id')
  @RequiresPro()
  @ApiOperation({ summary: 'Update a manual mileage entry' })
  @ApiParam({ name: 'id', description: 'Mileage entry ID' })
  @ApiResponse({ status: 200, description: 'Mileage entry updated' })
  async updateMileageEntry(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMileageEntryDto,
  ) {
    return {
      success: true,
      data: await this.reports.updateMileageEntry(userId, id, dto),
    };
  }

  @Delete('mileage/:id')
  @RequiresPro()
  @ApiOperation({ summary: 'Delete a manual mileage entry' })
  @ApiParam({ name: 'id', description: 'Mileage entry ID' })
  @ApiResponse({ status: 200, description: 'Mileage entry deleted' })
  async deleteMileageEntry(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return {
      success: true,
      data: await this.reports.deleteMileageEntry(userId, id),
    };
  }

  @Patch('mileage/job/:id')
  @RequiresPro()
  @ApiOperation({
    summary: 'Update an auto-tracked mileage entry via its job',
  })
  @ApiParam({ name: 'id', description: 'Job ID backing the auto entry' })
  @ApiResponse({ status: 200, description: 'Job mileage updated' })
  async updateJobMileage(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobMileageDto,
  ) {
    return {
      success: true,
      data: await this.reports.updateJobMileage(userId, id, dto),
    };
  }

  @Get('mileage')
  @RequiresPro()
  @ApiOperation({ summary: 'Get mileage report for a year' })
  @ApiQuery({
    name: 'year',
    required: false,
    example: '2025',
    description: 'Year (defaults to current)',
  })
  @ApiResponse({
    status: 200,
    description: 'Monthly mileage totals and IRS deduction',
  })
  async mileage(
    @CurrentUser('id') userId: string,
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    return { success: true, data: await this.reports.mileage(userId, y) };
  }

  @Get('tax')
  @RequiresPro()
  @ApiOperation({ summary: 'Get tax summary report for a date range' })
  @ApiQuery({
    name: 'from',
    required: true,
    example: '2026-01-01',
    description: 'Start date',
  })
  @ApiQuery({
    name: 'to',
    required: true,
    example: '2026-12-31',
    description: 'End date',
  })
  @ApiResponse({
    status: 200,
    description: 'Income, expenses, mileage deduction, and estimated tax',
  })
  async taxReport(
    @CurrentUser('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return {
      success: true,
      data: await this.reports.taxReport(userId, from, to),
    };
  }

  @Get('tax/pdf')
  @RequiresPro()
  @ApiOperation({ summary: 'Generate the Schedule C tax report PDF' })
  @ApiQuery({ name: 'from', required: true, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: true, example: '2026-12-31' })
  @ApiResponse({ status: 200, description: 'PDF file download' })
  async taxPdf(
    @CurrentUser('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res() res: Response,
  ) {
    const buffer = await this.reports.taxPdf(userId, from, to);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="schedule-c-tax-report.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }
}
