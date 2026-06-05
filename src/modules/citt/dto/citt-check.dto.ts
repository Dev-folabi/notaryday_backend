import {
  IsString,
  IsNumber,
  IsDateString,
  IsPositive,
  IsOptional,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SigningType } from '../../../../generated/prisma';

export class CittCheckDto {
  @ApiProperty({
    example: '456 Oak Ave, Round Rock, TX 78664',
    description: 'Full street address of the proposed job',
  })
  @IsString()
  address: string;

  @ApiProperty({
    example: '2025-06-01T14:00:00.000Z',
    description: 'ISO 8601 appointment start time',
  })
  @IsDateString()
  appointment_time: string;

  @ApiProperty({ example: 125, description: 'Offered fee in dollars' })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  fee: number;

  @ApiPropertyOptional({ enum: SigningType, default: 'GENERAL' })
  @IsEnum(SigningType)
  @IsOptional()
  signing_type?: SigningType = SigningType.GENERAL;

  @ApiPropertyOptional({
    example: 20,
    description: 'Platform deduction (e.g. Snapdocs fee)',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  platform_fee?: number = 0;

  @ApiPropertyOptional({
    example: 45,
    description: 'Override signing duration in minutes',
  })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  signing_duration_mins?: number;
}
