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
import { SigningType, JobSource } from '../../../../generated/prisma';

export class UpdateJobDto {
  @IsString()
  @IsOptional()
  address?: string;

  @IsDateString()
  @IsOptional()
  appointment_time?: string;

  @IsEnum(SigningType)
  @IsOptional()
  signing_type?: SigningType;

  @IsEnum(JobSource)
  @IsOptional()
  source?: JobSource;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  fee?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  platform_fee?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  signing_duration_mins?: number;

  @IsString()
  @IsOptional()
  client_name?: string;

  @IsString()
  @IsOptional()
  client_email?: string;

  @IsString()
  @IsOptional()
  client_phone?: string;

  @IsString()
  @IsOptional()
  platform_name?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  signer_count?: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}
