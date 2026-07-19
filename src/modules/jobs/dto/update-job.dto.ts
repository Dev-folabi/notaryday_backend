import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  IsPositive,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  SigningType,
  JobSource,
  JobStatus,
} from '../../../../generated/prisma';

export class UpdateJobDto {
  @ApiPropertyOptional({
    enum: JobStatus,
    description: 'Optional status transition',
  })
  @IsEnum(JobStatus)
  @IsOptional()
  status?: JobStatus;

  @ApiPropertyOptional({ example: '456 Oak Ave, Austin, TX 78702' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: '2025-06-01T15:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  appointment_time?: string;

  @ApiPropertyOptional({ enum: SigningType })
  @IsEnum(SigningType)
  @IsOptional()
  signing_type?: SigningType;

  @ApiPropertyOptional({ enum: JobSource })
  @IsEnum(JobSource)
  @IsOptional()
  source?: JobSource;

  @ApiPropertyOptional({ example: 175 })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  fee?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  platform_fee?: number;

  @ApiPropertyOptional({ example: 60 })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  signing_duration_mins?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  scanback_duration_mins?: number;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsString()
  @IsOptional()
  client_name?: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  @IsString()
  @IsOptional()
  client_email?: string;

  @ApiPropertyOptional({ example: '+15125559876' })
  @IsString()
  @IsOptional()
  client_phone?: string;

  @ApiPropertyOptional({ example: 'Notarize' })
  @IsString()
  @IsOptional()
  platform_name?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  signer_count?: number;

  @ApiPropertyOptional({ example: 'Updated notes' })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
