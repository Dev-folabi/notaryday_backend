import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PROVIDER_STATUSES, PROVIDER_TYPES } from '../marketing.constants';

export class UpdateProviderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional({ enum: PROVIDER_TYPES })
  @IsOptional()
  @IsIn(PROVIDER_TYPES)
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  fromName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  fromEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @ApiPropertyOptional({
    description:
      'Partial or full credentials; merged with existing before re-encryption',
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  perMinuteLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000)
  dailyLimit?: number;

  @ApiPropertyOptional({ enum: PROVIDER_STATUSES })
  @IsOptional()
  @IsIn(PROVIDER_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  warmupEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
