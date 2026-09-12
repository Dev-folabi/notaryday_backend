import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { WavesService } from './waves.service';

class UpdateWaveDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedStart?: string;

  @ApiPropertyOptional({ enum: ['PLANNED', 'ACTIVE', 'COMPLETED'] })
  @IsOptional()
  @IsIn(['PLANNED', 'ACTIVE', 'COMPLETED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

@ApiTags('Marketing Waves')
@ApiBearerAuth()
@Controller('marketing/waves')
@UseGuards(AuthGuard, AdminGuard)
export class WavesController {
  constructor(private readonly waves: WavesService) {}

  @Get()
  @ApiOperation({
    summary: 'All waves with live progress from leads/recipients',
  })
  async list() {
    return { success: true, data: await this.waves.list() };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a wave (name, planned start, status, notes)',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateWaveDto) {
    return { success: true, data: await this.waves.update(id, dto) };
  }
}
