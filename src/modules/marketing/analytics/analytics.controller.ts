import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('Marketing Analytics')
@ApiBearerAuth()
@Controller('marketing/analytics')
@UseGuards(AuthGuard, AdminGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Dashboard aggregates: totals, funnel, per-day series, AB, steps',
  })
  async overview(@Query('days') days?: string) {
    const parsed = Number(days);
    const window = Math.min(
      90,
      Math.max(7, Number.isFinite(parsed) ? parsed : 30),
    );
    return {
      success: true,
      data: await this.analytics.overview(window),
    };
  }

  @Get('leads/:id/timeline')
  @ApiOperation({ summary: 'Engagement event timeline for one lead' })
  async leadTimeline(@Param('id') id: string) {
    return {
      success: true,
      data: await this.analytics.leadTimeline(id),
    };
  }
}
