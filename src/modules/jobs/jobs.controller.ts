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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { UpdateJobStatusDto } from './dto/update-job-status.dto';
import { JobStatus } from '../../../generated/prisma';

@ApiTags('Jobs')
@ApiBearerAuth()
@Controller('jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new signing job' })
  @ApiResponse({ status: 201, description: 'Job created' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateJobDto) {
    const job = await this.jobs.create(userId, dto);
    return { success: true, data: job };
  }

  @Get()
  @ApiOperation({ summary: 'List all jobs for the current user' })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-06-01',
    description: 'Filter by date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: JobStatus,
    description: 'Filter by status',
  })
  @ApiResponse({ status: 200, description: 'Array of jobs' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('date') date?: string,
    @Query('status') status?: JobStatus,
  ) {
    const jobs = await this.jobs.findAll(userId, { date, status });
    return { success: true, data: jobs, meta: { count: jobs.length } };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single job by ID' })
  @ApiParam({ name: 'id', description: 'Job UUID' })
  @ApiResponse({ status: 200, description: 'Job object' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const job = await this.jobs.findOne(userId, id);
    return { success: true, data: job };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a job' })
  @ApiParam({ name: 'id', description: 'Job UUID' })
  @ApiResponse({ status: 200, description: 'Updated job' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    const job = await this.jobs.update(userId, id, dto);
    return { success: true, data: job };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update job status (e.g. CONFIRMED → IN_PROGRESS)' })
  @ApiParam({ name: 'id', description: 'Job UUID' })
  @ApiResponse({ status: 200, description: 'Updated job with new status' })
  async updateStatus(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobStatusDto,
  ) {
    const job = await this.jobs.updateStatus(userId, id, dto.status);
    return { success: true, data: job };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a job' })
  @ApiParam({ name: 'id', description: 'Job UUID' })
  @ApiResponse({ status: 204, description: 'Job deleted' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.jobs.remove(userId, id);
  }
}
