import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('earnings')
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
  @ApiResponse({ status: 200, description: 'Earnings data grouped by period' })
  async earnings(
    @CurrentUser('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('group_by') groupBy?: 'week' | 'month',
  ) {
    return {
      success: true,
      data: await this.reports.earnings(userId, from, to, groupBy),
    };
  }

  @Get('mileage')
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
  @ApiOperation({ summary: 'Get tax summary report for a year' })
  @ApiQuery({
    name: 'year',
    required: false,
    example: '2025',
    description: 'Tax year (defaults to current)',
  })
  @ApiResponse({
    status: 200,
    description: 'Income, expenses, mileage deduction, and estimated tax',
  })
  async taxReport(
    @CurrentUser('id') userId: string,
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    return { success: true, data: await this.reports.taxReport(userId, y) };
  }
}
