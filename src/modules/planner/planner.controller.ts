import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlanGuard } from '../../common/guards/plan.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlannerService } from './planner.service';
import { RequiresPro } from '../../common/decorators/requires-pro.decorator';

@ApiTags('Planner')
@ApiBearerAuth()
@Controller('planner')
@UseGuards(AuthGuard)
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Get('today')
  @ApiOperation({
    summary: "Get today's route plan with jobs, legs, and totals",
  })
  @ApiQuery({
    name: 'date',
    required: true,
    example: '2025-06-01',
    description: 'Date (YYYY-MM-DD)',
  })
  @ApiResponse({
    status: 200,
    description: 'Route plan with ordered jobs, drive legs, and summary stats',
  })
  async getToday(
    @CurrentUser('id') userId: string,
    @Query('date') date: string,
  ) {
    const result = await this.planner.getToday(userId, date);
    return { success: true, data: result };
  }

  @Post('optimise')
  @UseGuards(PlanGuard)
  @RequiresPro()
  @ApiOperation({ summary: 'Optimise route order for a given day (Pro only)' })
  @ApiBody({
    schema: { properties: { date: { type: 'string', example: '2025-06-01' } } },
  })
  @ApiResponse({ status: 200, description: 'Optimised route plan' })
  @ApiResponse({ status: 403, description: 'Pro subscription required' })
  async optimise(
    @CurrentUser('id') userId: string,
    @Body('date') date: string,
  ) {
    const result = await this.planner.optimise(userId, date);
    return { success: true, data: result };
  }

  @Get('gaps')
  @UseGuards(PlanGuard)
  @RequiresPro()
  @ApiOperation({
    summary: 'Find schedule gaps that could fit another job (Pro only)',
  })
  @ApiQuery({ name: 'date', required: true, example: '2025-06-01' })
  @ApiResponse({ status: 200, description: 'Array of available time gaps' })
  @ApiResponse({ status: 403, description: 'Pro subscription required' })
  async getGaps(
    @CurrentUser('id') userId: string,
    @Query('date') date: string,
  ) {
    const gaps = await this.planner.findGaps(userId, date);
    return { success: true, data: gaps };
  }
}
