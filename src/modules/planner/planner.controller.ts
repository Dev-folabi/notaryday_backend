import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlanGuard } from '../../common/guards/plan.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresPro } from '../../common/decorators/requires-pro.decorator';
import { PlannerService } from './planner.service';

@Controller('planner')
@UseGuards(AuthGuard)
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  /** GET /api/v1/planner/today?date=YYYY-MM-DD */
  @Get('today')
  async getToday(
    @CurrentUser('id') userId: string,
    @Query('date') date: string,
  ) {
    const result = await this.planner.getToday(userId, date);
    return { success: true, data: result };
  }

  /** POST /api/v1/planner/optimise */
  @Post('optimise')
  @UseGuards(PlanGuard)
  @RequiresPro()
  async optimise(
    @CurrentUser('id') userId: string,
    @Body('date') date: string,
  ) {
    const result = await this.planner.optimise(userId, date);
    return { success: true, data: result };
  }

  /** GET /api/v1/planner/gaps?date=YYYY-MM-DD */
  @Get('gaps')
  @UseGuards(PlanGuard)
  @RequiresPro()
  async getGaps(
    @CurrentUser('id') userId: string,
    @Query('date') date: string,
  ) {
    const gaps = await this.planner.findGaps(userId, date);
    return { success: true, data: gaps };
  }
}
