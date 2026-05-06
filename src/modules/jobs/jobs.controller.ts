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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { JobStatus } from '../../../generated/prisma';

@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** POST /api/v1/jobs */
  @Post()
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateJobDto) {
    const job = await this.jobs.create(userId, dto);
    return { success: true, data: job };
  }

  /** GET /api/v1/jobs?date=YYYY-MM-DD&status=CONFIRMED */
  @Get()
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
    @Query('status') status?: JobStatus,
  ) {
    const jobs = await this.jobs.findAll(userId, { date, status });
    return { success: true, data: jobs, meta: { count: jobs.length } };
  }

  /** GET /api/v1/jobs/:id */
  @Get(':id')
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const job = await this.jobs.findOne(userId, id);
    return { success: true, data: job };
  }

  /** PATCH /api/v1/jobs/:id */
  @Patch(':id')
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    const job = await this.jobs.update(userId, id, dto);
    return { success: true, data: job };
  }

  /** PATCH /api/v1/jobs/:id/status */
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobStatusDto,
  ) {
    const job = await this.jobs.updateStatus(userId, id, dto.status);
    return { success: true, data: job };
  }

  /** DELETE /api/v1/jobs/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.jobs.remove(userId, id);
  }
}
