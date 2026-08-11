import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMileageEntryDto {
  @ApiProperty({ example: '2026-03-18', description: 'Entry date (ISO 8601)' })
  @IsDateString()
  miles_date: string;

  @ApiProperty({ example: 42.5, description: 'Miles driven' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  miles: number;

  @ApiProperty({ example: 'Lender meeting, Wilshire Blvd' })
  @IsString()
  @MaxLength(500)
  description: string;
}

export class UpdateMileageEntryDto {
  @ApiPropertyOptional({ example: '2026-03-19' })
  @IsDateString()
  @IsOptional()
  miles_date?: string;

  @ApiPropertyOptional({ example: 48.0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  miles?: number;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
