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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SigningType,
  JobSource,
  JobStatus,
} from '../../../../generated/prisma';

export class CreateJobDto {
  @ApiProperty({ example: '123 Main St, Austin, TX 78701' })
  @IsString()
  address: string;

  @ApiProperty({
    example: '2025-06-01T14:00:00.000Z',
    description: 'ISO 8601 appointment time',
  })
  @IsDateString()
  appointment_time: string;

  @ApiPropertyOptional({ enum: SigningType, default: SigningType.GENERAL })
  @IsEnum(SigningType)
  @IsOptional()
  signing_type?: SigningType = SigningType.GENERAL;

  @ApiPropertyOptional({ enum: JobSource, default: JobSource.MANUAL })
  @IsEnum(JobSource)
  @IsOptional()
  source?: JobSource = JobSource.MANUAL;

  @ApiProperty({ example: 150, description: 'Fee in dollars' })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  fee: number;

  @ApiPropertyOptional({
    example: 25,
    description: 'Platform deduction (e.g. Snapdocs fee)',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  platform_fee?: number = 0;

  @ApiPropertyOptional({
    example: 45,
    description: 'Signing duration in minutes',
  })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  signing_duration_mins?: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Scanback duration in minutes',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  scanback_duration_mins?: number;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  client_name?: string;

  @ApiPropertyOptional({
    enum: JobStatus,
    description: 'Initial status. Defaults to CONFIRMED for manual jobs',
  })
  @IsEnum(JobStatus)
  @IsOptional()
  status?: JobStatus;

  @ApiPropertyOptional({ example: 'client@example.com' })
  @IsString()
  @IsOptional()
  client_email?: string;

  @ApiPropertyOptional({ example: '+15125551234' })
  @IsString()
  @IsOptional()
  client_phone?: string;

  @ApiPropertyOptional({ example: 'Snapdocs' })
  @IsString()
  @IsOptional()
  platform_name?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Number of signers',
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  signer_count?: number = 1;

  @ApiPropertyOptional({ example: 'Loan refi, 2 packages', maxLength: 2000 })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
