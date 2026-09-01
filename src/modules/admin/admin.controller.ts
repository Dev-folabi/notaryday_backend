import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { UpdateUserPlanDto } from './dto/update-plan.dto';
import { PlanTier } from '../../../generated/prisma';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats/overview')
  @ApiOperation({ summary: 'Platform-wide KPI overview' })
  @ApiResponse({ status: 200, description: 'Overview stats' })
  async overview() {
    return { success: true, data: await this.admin.getOverview() };
  }

  @Get('users')
  @ApiOperation({ summary: 'List users with filters & pagination' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'plan', required: false, enum: PlanTier })
  @ApiQuery({ name: 'onboarding', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'suspended', required: false, enum: ['true'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async users(
    @Query('search') search?: string,
    @Query('plan') plan?: PlanTier,
    @Query('onboarding') onboarding?: string,
    @Query('suspended') suspended?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return {
      ...(await this.admin.listUsers({
        search,
        plan,
        onboarding,
        suspended,
        page: Number(page) || 1,
        limit: Number(limit) || 20,
      })),
      success: true,
    };
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'User detail with aggregate stats' })
  @ApiResponse({ status: 200, description: 'User detail' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async userDetail(@Param('id') id: string) {
    return { success: true, data: await this.admin.getUserDetail(id) };
  }

  @Patch('users/:id/plan')
  @ApiOperation({ summary: 'Change a user plan tier' })
  async updatePlan(@Param('id') id: string, @Body() dto: UpdateUserPlanDto) {
    return {
      success: true,
      data: await this.admin.updateUserPlan(id, dto.plan, dto.planExpiresAt),
    };
  }

  @Post('users/:id/reset-password')
  @ApiOperation({ summary: 'Send a password reset email to a user' })
  async resetPassword(@Param('id') id: string) {
    return { success: true, data: await this.admin.resetPassword(id) };
  }

  @Post('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend a user (soft delete + drop billing)' })
  async suspend(@Param('id') id: string) {
    return { success: true, data: await this.admin.suspendUser(id) };
  }

  @Post('users/:id/restore')
  @ApiOperation({ summary: 'Restore a suspended user' })
  async restore(@Param('id') id: string) {
    return { success: true, data: await this.admin.restoreUser(id) };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Browse jobs across all users' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async jobs(
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return {
      ...(await this.admin.listJobs({
        status,
        source,
        userId,
        from,
        to,
        page: Number(page) || 1,
        limit: Number(limit) || 20,
      })),
      success: true,
    };
  }

  @Get('system/health')
  @ApiOperation({ summary: 'Queue, import, invoice & webhook health' })
  async systemHealth() {
    return { success: true, data: await this.admin.systemHealth() };
  }
}
